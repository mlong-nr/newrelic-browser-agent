import { gosNREUM } from '../window/nreum'
import { globalScope } from '../constants/runtime'

/**
 * Class used to adjust the timestamp of harvested data to New Relic server time. This
 * is done by tracking the performance timings of the RUM call and applying a calculation
 * to the harvested data event offset time.
 */
export class TimeKeeper {
  /**
   * Represents the browser origin time.
   * @type {number}
   */
  #originTime

  /**
   * Represents the browser origin time corrected to NR server time.
   * @type {number}
   */
  #correctedOriginTime

  /**
   * Represents the difference in milliseconds between the calculated NR server time and
   * the local time.
   * @type {number}
   */
  #localTimeDiff

  constructor (originTime) {
    if (!originTime) throw new Error('TimeKeeper must be supplied a browser origin time.')
    this.#originTime = originTime
  }

  static getTimeKeeperByAgentIdentifier (agentIdentifier) {
    const nr = gosNREUM()
    return Object.keys(nr?.initializedAgents || {}).indexOf(agentIdentifier) > -1
      ? nr.initializedAgents[agentIdentifier].timeKeeper
      : undefined
  }

  get originTime () {
    return this.#originTime
  }

  get correctedOriginTime () {
    if (!this.#correctedOriginTime) throw new Error('InvalidState: Access to correctedOriginTime attempted before NR time calculated.')
    return this.#correctedOriginTime
  }

  /**
   * Process a rum request to calculate NR server time.
   * @param rumRequest {XMLHttpRequest} The xhr for the rum request
   * @param rumRequestUrl {string} The full url of the rum request
   */
  processRumRequest (rumRequest, rumRequestUrl) {
    const responseDateHeader = rumRequest.getResponseHeader('Date')
    if (!responseDateHeader) {
      throw new Error('Missing date header on rum response.')
    }

    const resourceEntries = globalScope.performance.getEntriesByName(rumRequestUrl, 'resource')
    if (!Array.isArray((resourceEntries)) || resourceEntries.length === 0) {
      throw new Error('Missing rum request performance entry.')
    }

    let medianRumOffset = 0
    let serverOffset = 0
    if (typeof resourceEntries[0].responseStart === 'number' && resourceEntries[0].responseStart !== 0) {
      // Cors is enabled and we can make a more accurate calculation of NR server time
      medianRumOffset = (resourceEntries[0].responseStart - resourceEntries[0].requestStart) / 2
      serverOffset = Math.floor(resourceEntries[0].requestStart + medianRumOffset)
    } else {
      // Cors is disabled or erred, we need to use a less accurate calculation
      medianRumOffset = (resourceEntries[0].responseEnd - resourceEntries[0].fetchStart) / 2
      serverOffset = Math.floor(resourceEntries[0].fetchStart + medianRumOffset)
    }

    // Corrected page origin time
    this.#correctedOriginTime = Math.floor(Date.parse(responseDateHeader) - serverOffset)
    this.#localTimeDiff = this.#originTime - this.#correctedOriginTime

    if (Number.isNaN(this.#correctedOriginTime)) {
      throw new Error('Date header invalid format.')
    }
  }

  /**
   * Converts a page origin relative time to an absolute timestamp
   * corrected to NR server time.
   * @param relativeTime {number} The relative time of the event in milliseconds
   * @returns {number} Corrected unix/epoch timestamp
   */
  convertRelativeTimestamp (relativeTime) {
    if (!this.#correctedOriginTime) throw new Error('InvalidState: Timing correction attempted before NR time calculated.')
    return this.#correctedOriginTime + relativeTime
  }

  /**
   * Corrects an event timestamp to NR server time.
   * @param timestamp {number} The unix/epoch timestamp of the event with milliseconds
   * @return {number} Corrected unix/epoch timestamp
   */
  correctAbsoluteTimestamp (timestamp) {
    if (!this.#localTimeDiff) throw new Error('InvalidState: Timing correction attempted before NR time calculated.')
    return Math.floor(timestamp - this.#localTimeDiff)
  }

  /**
   * Returns the current time offset from page origin.
   * @return {number}
   */
  now () {
    return Math.floor(performance.now())
  }
}
