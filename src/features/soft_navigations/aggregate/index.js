import { getConfigurationValue } from '../../../common/config/config'
import { handle } from '../../../common/event-emitter/handle'
import { registerHandler } from '../../../common/event-emitter/register-handler'
import { HarvestScheduler } from '../../../common/harvest/harvest-scheduler'
import { single } from '../../../common/util/invoke'
import { timeToFirstByte } from '../../../common/vitals/time-to-first-byte'
import { FEATURE_NAMES } from '../../../loaders/features/features'
import { AggregateBase } from '../../utils/aggregate-base'
import { FEATURE_NAME, INTERACTION_STATUS } from '../constants'
import { AjaxNode } from './ajax-node'
import { InitialPageLoadInteraction } from './initial-page-load-interaction'
import { Interaction } from './interaction'

export class Aggregate extends AggregateBase {
  static featureName = FEATURE_NAME
  constructor (agentIdentifier, aggregator) {
    super(agentIdentifier, aggregator, FEATURE_NAME)

    const harvestTimeSeconds = getConfigurationValue(agentIdentifier, 'spa.harvestTimeSeconds') || 10
    this.interactionsToHarvest = []
    this.interactionsAwaitingRetry = []

    this.scheduler = new HarvestScheduler('events', {
      onFinished: this.onHarvestFinished.bind(this),
      retryDelay: harvestTimeSeconds
    }, { agentIdentifier, ee: this.ee })
    this.scheduler.harvest.on('events', this.onHarvestStarted.bind(this))

    this.initialPageLoadInteraction = new InitialPageLoadInteraction(agentIdentifier)
    timeToFirstByte.subscribe(({ entries }) => {
      const loadEventTime = Math.round(entries[0].loadEventEnd)
      this.initialPageLoadInteraction.finish(loadEventTime)
      this.interactionsToHarvest.push(this.initialPageLoadInteraction)
      this.initialPageLoadInteraction = null
    })

    this.interactionInProgress = null // aside from the "page load" interaction, there can only ever be 1 ongoing at a time

    this.blocked = false
    this.waitForFlags(['spa']).then(([spaOn]) => {
      if (spaOn) this.scheduler.startTimer(harvestTimeSeconds, 0)
      else this.blocked = true // if rum response determines that customer lacks entitlements for spa endpoint, this feature shouldn't harvest
    })

    // const tracerEE = this.ee.get('tracer') // used to get API-driven interactions

    registerHandler('newInteraction', (timestamp, trigger) => this.startAnInteraction(trigger, timestamp), this.featureName, this.ee)
    registerHandler('newURL', (timestamp, url) => {
      this.interactionInProgress?.updateHistory(timestamp, url)
      if (this.interactionInProgress?.seenHistoryAndDomChange) this.interactionInProgressFinished()
    }, this.featureName, this.ee)
    registerHandler('newDom', timestamp => {
      this.interactionInProgress?.updateDom(timestamp)
      if (this.interactionInProgress?.seenHistoryAndDomChange) this.interactionInProgressFinished()
    }, this.featureName, this.ee)

    registerHandler('ajax', this.#handleAjaxEvent.bind(this), this.featureName, this.ee)
    registerHandler('jserror', this.#handleJserror.bind(this), this.featureName, this.ee)

    this.drain()
  }

  onHarvestStarted (options) {
    if (this.interactionsToHarvest.length === 0 || this.blocked) return

    const serializedIxnList = this.interactionsToHarvest.map(interaction => interaction.serialize())
    const payload = `bel.7;${serializedIxnList.join(';')}`

    if (options.retry) this.interactionsAwaitingRetry.push(...this.interactionsToHarvest)
    this.interactionsToHarvest = []

    return { body: { e: payload } }
  }

  onHarvestFinished (result) {
    if (result.sent && result.retry && this.interactionsAwaitingRetry.length > 0) {
      this.interactionsToHarvest = [...this.interactionsAwaitingRetry, ...this.interactionsToHarvest]
      this.interactionsAwaitingRetry = []
    }
  }

  startAnInteraction (eventName, startedAt) { // this is throttled by instrumentation so that it isn't excessively called
    this.interactionInProgress?.cancel()

    this.interactionInProgress = new Interaction(this.agentIdentifier, eventName, startedAt)
    this.interactionInProgress.on('cancelled', () => (this.interactionInProgress = null)) // since the ixn can be cancelled on its own
  }

  interactionInProgressFinished () {
    this.interactionInProgress.finish()
    this.interactionsToHarvest.push(this.interactionInProgress)
    this.interactionInProgress = null
  }

  /**
   * Find the active interaction (current or past) for a given timestamp. Note that historic lookups mostly only go as far back as the last harvest for this feature.
   * Also, the caller should check the status of the interaction returned if found via {@link Interaction.status}, if that's pertinent.
   * Cancelled (status) interactions are NOT returned!
   * @param {DOMHighResTimeStamp} timestamp
   * @returns An {@link Interaction} or undefined, if no active interaction was found.
   */
  getInteractionFor (timestamp) {
    if (this.interactionInProgress?.isActiveDuring(timestamp)) return this.interactionInProgress
    /* In the sole case wherein there can be two "interactions" overlapping (initialPageLoad + regular route-change),
      the regular interaction should get precedence in being assigned the "active" interaction in regards to our one-at-a-time model.
      Hence, in case the initialPageLoad is pending harvest, we reverse search for the latest completed interaction since iPL is always added first.
    */
    for (let idx = this.interactionsToHarvest.length - 1; idx >= 0; idx--) {
      const finishedInteraction = this.interactionsToHarvest[idx]
      if (finishedInteraction.isActiveDuring(timestamp)) return finishedInteraction
    }
    if (this.initialPageLoadInteraction?.isActiveDuring(timestamp)) return this.initialPageLoadInteraction // lowest precedence and also only if it's still in-progress
    // Time must be when no interaction is happening, so return undefined.
  }

  /**
   * Handles or redirect ajax event based on the interaction, if any, that it's tied to.
   * @param {Object} event see Ajax feature's storeXhr function for object definition
   */
  #handleAjaxEvent (event) {
    const associatedInteraction = this.getInteractionFor(event.startTime)
    if (!associatedInteraction) { // no interaction was happening when this ajax started, so give it back to Ajax feature for processing
      handle('returnAjax', [event], undefined, FEATURE_NAMES.ajax, this.ee)
    } else {
      if (associatedInteraction.status === INTERACTION_STATUS.FIN) processAjax(event, associatedInteraction) // tack ajax onto the ixn object awaiting harvest
      else { // same thing as above, just at a later time -- if the interaction in progress is cancelled, just send the event back to ajax feat unmodified
        associatedInteraction.on('finished', () => processAjax(event, associatedInteraction))
        associatedInteraction.on('cancelled', () => handle('returnAjax', [event], undefined, FEATURE_NAMES.ajax, this.ee))
      }
    }

    function processAjax (event, parentInteraction) {
      const newNode = new AjaxNode(event)
      parentInteraction.addChild(newNode)
    }
  }

  /**
   * Decorate the passed-in params obj with properties relating to any associated interaction at the time of the timestamp.
   * @param {Object} params reference to the local var instance in Jserrors feature's storeError
   * @param {DOMHighResTimeStamp} timestamp time the jserror occurred
   */
  #handleJserror (params, timestamp) {
    const associatedInteraction = this.getInteractionFor(timestamp)
    if (!associatedInteraction) return // do not need to decorate this jserror params

    // Whether the interaction is in-progress or already finished, the id will let jserror buffer it under its index, until it gets the next step instruction.
    params.browserInteractionId = associatedInteraction.id
    if (associatedInteraction.status === INTERACTION_STATUS.FIN) {
      // This information cannot be relayed back via handle() that flushes buffered errs because this is being called by a jserror's handle() per se and before the err is buffered.
      params._softNavFinished = true // instead, signal that this err can be processed right away without needing to be buffered aka wait for an in-progress ixn
      params._softNavAttributes = associatedInteraction.customAttributes
    } else {
      // These callbacks may be added multiple times for an ixn, but just a single run will deal with all jserrors associated with the interaction.
      // As such, be cautious not to use the params object since that's tied to one specific jserror and won't affect the rest of them.
      associatedInteraction.on('finished', single(() =>
        handle('softNavFlush', [associatedInteraction.id, true, associatedInteraction.customAttributes], undefined, FEATURE_NAMES.jserrors, this.ee)))
      associatedInteraction.on('cancelled', single(() =>
        handle('softNavFlush', [associatedInteraction.id, false, undefined], undefined, FEATURE_NAMES.jserrors, this.ee))) // don't take custom attrs from cancelled ixns
    }
  }
}