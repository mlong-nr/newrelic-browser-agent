class TestServerLogger {
  level = 'info'

  #config
  #parentLogger

  constructor (config) {
    this.#config = config

    if (!config.logger) {
      this.#parentLogger = console
    } else {
      this.#parentLogger = config.logger
    }
  }

  logNetworkRequest (request, reply) {
    if (reply.statusCode >= 400 && request.server.testServerId === 'assetServer') {
      this.#parentLogger.error(`${request.server.testServerId} -> ${request.method} ${request.url} ${reply.statusCode}`)
      this.#parentLogger.error(request.body)
      this.#parentLogger.error(reply.body)
      return
    }

    if (this.#config.logRequests) {
      this.#parentLogger.info(`${request.server.testServerId} -> ${request.method} ${request.url} ${reply.statusCode}`)
    }
  }

  logDebugShimMessage (request) {
    this.#parentLogger.info(`DEBUG [${request.query.testId}](${request.query.ix}): ${request.query.m}`)
  }
}

module.exports = TestServerLogger
