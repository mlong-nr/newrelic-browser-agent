import process from 'process'
import fs from 'fs-extra'
import path from 'path'
import url from 'url'
import crypto from 'crypto'
import { deepmerge } from 'deepmerge-ts'
import { Launcher } from '@wdio/cli'
import { serialize } from 'serialize-anything'
import baseConfig from './config/base.conf.mjs'
import specsConfig from './config/specs.conf.mjs'
import seleniumConfig from './config/selenium.conf.mjs'
import sauceConfig from './config/sauce.conf.mjs'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

/**
 * The runner utilizes the CLI arguments to dynamically generate the
 * wdio configuration file. The file is written to disk and passed to the
 * wdio launcher. WDIO is launched this way to ensure the configuration is
 * properly passed to the worker processes.
 */

const wdioConfig = deepmerge(baseConfig(), specsConfig(), seleniumConfig(),
  // Saucelabs
  // sauceConfig()

  // Browserstack
  // {
  //   user: 'patrickhousley_Y2axec',
  //   key: 'A7NUjmxSyKAnv7yNs2UM',
  //   services: [
  //     ['browserstack', {
  //       browserstackLocal: true
  //     }]
  //   ],
  //   capabilities: [
  //     // {
  //     //   'bstack:options': {
  //     //     os: 'Windows',
  //     //     osVersion: '11',
  //     //     browserVersion: '114'
  //     //   },
  //     //   browserName: 'chrome'
  //     // }

  //     // {
  //     //   'bstack:options': {
  //     //     os: 'Windows',
  //     //     osVersion: '10',
  //     //     browserVersion: '11.0'
  //     //   },
  //     //   browserName: 'IE'
  //     // }

  //     {
  //       'bstack:options': {
  //         os: 'OS X',
  //         osVersion: 'Monterey',
  //         browserVersion: '15'
  //       },
  //       browserName: 'safari',
  //       browserVersion: 15
  //     }

  //     // {
  //     //   'bstack:options': {
  //     //     osVersion: '15',
  //     //     deviceName: 'iPhone 13',
  //     //     appiumVersion: '2.0.0'
  //     //   },
  //     //   platformName: 'ios',
  //     //   browserName: 'safari',
  //     //   browserVersion: '15'
  //     // }
  //   ]
  // }

  // LambdaTest
  {
    user: 'phousley@newrelic.com',
    key: 'W4HukN0J3j95PHC9DBqRv7QSc7YM8vuL5WGSJNo63cEzWzKzrb',
    services: [
      ['lambdatest', {
        tunnel: true,
        lambdatestOpts: {
          allowHosts: 'bam-test-1.nr-local.net'
        }
      }]
    ],
    capabilities: [{
      platformName: 'Windows 11',
      browserName: 'chrome',
      browserVersion: '114',

      // browserName: 'safari',
      // version: '15',

      // browserName: 'internet explorer',
      // browserVersion: '11.0',

      // platformName: 'ios',
      // deviceName: 'iPhone 13',
      // platformVersion: '15',
      // isRealMobile: true,

      'LT:Options': {
        w3c: true,
        selenium_version: '4.9.0'
      }
    }, {
      platformName: 'Windows 11',
      browserName: 'chrome',
      browserVersion: '111',

      // browserName: 'safari',
      // version: '15',

      // browserName: 'internet explorer',
      // browserVersion: '11.0',

      // platformName: 'ios',
      // deviceName: 'iPhone 13',
      // platformVersion: '15',
      // isRealMobile: true,

      'LT:Options': {
        w3c: true,
        selenium_version: '4.9.0'
      }
    }, {
      platformName: 'Windows 11',
      browserName: 'chrome',
      browserVersion: '109',

      // browserName: 'safari',
      // version: '15',

      // browserName: 'internet explorer',
      // browserVersion: '11.0',

      // platformName: 'ios',
      // deviceName: 'iPhone 13',
      // platformVersion: '15',
      // isRealMobile: true,

      'LT:Options': {
        w3c: true,
        selenium_version: '4.9.0'
      }
    }, {
      platformName: 'Windows 11',
      browserName: 'chrome',
      browserVersion: '106',

      // browserName: 'safari',
      // version: '15',

      // browserName: 'internet explorer',
      // browserVersion: '11.0',

      // platformName: 'ios',
      // deviceName: 'iPhone 13',
      // platformVersion: '15',
      // isRealMobile: true,

      'LT:Options': {
        w3c: true,
        selenium_version: '4.9.0'
      }
    }],
    path: '/wd/hub',
    hostname: 'hub.lambdatest.com',
    // hostname: 'mobile-hub.lambdatest.com', // For LT real mobile device testing
    port: 80
  }
)

// SauceLabs Real Devices
// wdioConfig.capabilities[0]['appium:deviceName'] = undefined
// wdioConfig.capabilities[0]['appium:platformVersion'] = '15'
// wdioConfig.capabilities[0]['appium:deviceName'] = 'iPhone Instant Simulator'
// wdioConfig.capabilities[0]['appium:platformVersion'] = 'previous_major'

// console.log(JSON.stringify(wdioConfig))
// process.exit(1)
const configFilePath = path.join(
  path.resolve(__dirname, '../../node_modules/.cache/wdio'),
  `wdio.conf_${crypto.randomBytes(16).toString('hex')}.mjs`
)

if (['trace', 'debug', 'info'].indexOf(wdioConfig.logLevel) > -1) {
  console.log(`Writing wdio config file to ${configFilePath}`)
}

fs.ensureDirSync(path.dirname(configFilePath))

// Clear the CLI params before starting wdio so they are not passed to worker processes
process.argv.splice(2)
fs.writeFile(
  configFilePath,
  `import { deserialize } from 'serialize-anything'\nexport const config = deserialize('${serialize(wdioConfig)}')`,
  (error) => {
    if (error) {
      console.error(error)
      process.exit(1)
    }

    const wdio = new Launcher(configFilePath)
    wdio.run().then(
      (exitCode) => {
        // testingServer.stop();
        process.exit(exitCode)
      },
      (error) => {
        // testingServer.stop();
        console.error('Launcher failed to start the test', error.stacktrace)
        process.exit(1)
      }
    )
  }
)
