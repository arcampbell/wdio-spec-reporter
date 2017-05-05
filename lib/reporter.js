import events from 'events'
import humanizeDuration from 'humanize-duration'

const DURATION_OPTIONS = {
    units: ['m', 's'],
    round: true,
    spacer: ''
}

/**
 * Initialize a new `spec` test reporter.
 *
 * @param {Runner} runner
 * @api public
 */
class SpecReporter extends events.EventEmitter {
    constructor (baseReporter, config, options = {}) {
        super()

        this.baseReporter = baseReporter
        this.config = config
        this.options = options
        this.shortEnglishHumanizer = humanizeDuration.humanizer({
            language: 'shortEn',
            languages: { shortEn: {
                h: () => 'h',
                m: () => 'm',
                s: () => 's',
                ms: () => 'ms'
            }}
        })

        this.errorCount = 0
        this.indents = {}
        this.suiteIndents = {}
        this.specs = {}
        this.results = {}
        this.context = {}
        this.realtime = (this.config !== undefined && this.config.maxInstances === 1)

        this.on('runner:start', function (runner) {
            this.suiteIndents[runner.cid] = {}
            this.indents[runner.cid] = 0
            this.specs[runner.cid] = runner.specs
            this.results[runner.cid] = {
                passing: 0,
                pending: 0,
                failing: 0
            }
            if (this.realtime) {
                this.context.runner = runner
                this.context.headerPrinted = false
            }
        })

        this.on('suite:start', function (suite) {
            this.suiteIndents[suite.cid][suite.uid] = ++this.indents[suite.cid]
            if (this.realtime) {
                this.context.suite = suite
                if (!this.context.headerPrinted) {
                    this.printHeader(this.context.runner)
                    this.context.headerPrinted = true
                }
                this.printSuiteHeader(suite)
            }
        })

        this.on('test:pending', function (test) {
            this.results[test.cid].pending++
            if (this.realtime) {
                test.state = 'pending'
                this.printTestResult(this.context.suite, test)
            }
        })

        this.on('test:pass', function (test) {
            this.results[test.cid].passing++
            if (this.realtime) {
                test.state = 'pass'
                this.printTestResult(this.context.suite, test)
            }
        })

        this.on('test:fail', function (test) {
            this.results[test.cid].failing++
            if (this.realtime) {
                test.state = 'fail'
                this.printTestResult(this.context.suite, test)
            }
        })

        this.on('suite:end', function (suite) {
            this.indents[suite.cid]--
            if (this.realtime) {
                this.context.suite = undefined
            }
        })

        this.on('runner:end', function (runner) {
            if (!this.realtime) {
                this.printSuiteResult(runner)
            } else {
                const cid = runner.cid
                const stats = this.baseReporter.stats
                const results = stats.runners[cid]
                const spec = results.specs[stats.getSpecHash(this.context.runner)]
                let output = ''
                output += `${this.context.preface}\n${this.context.preface}\n`
                output += this.getSummary(this.results[cid], spec._duration, this.context.preface)
                output += `${this.context.preface}\n`
                console.log(output)
            }
        })

        this.on('end', function () {
            this.printSuitesSummary()
        })
    }

    indent (cid, uid) {
        const indents = this.suiteIndents[cid][uid]
        return indents === 0 ? '' : Array(indents).join('    ')
    }

    getSymbol (state) {
        const { symbols } = this.baseReporter
        let symbol = '?' // in case of an unknown state

        switch (state) {
        case 'pass':
            symbol = symbols.ok
            break
        case 'pending':
            symbol = '-'
            break
        case 'fail':
            this.errorCount++
            symbol = this.errorCount + ')'
            break
        }

        return symbol
    }

    getColor (state) {
        let color = null // in case of an unknown state

        switch (state) {
        case 'pass':
        case 'passing':
            color = 'green'
            break
        case 'pending':
            color = 'pending'
            break
        case 'fail':
        case 'failing':
            color = 'fail'
            break
        }

        return color
    }

    getBrowserCombo (caps, verbose = true) {
        const device = caps.deviceName
        const browser = caps.browserName || caps.browser
        const version = caps.version || caps.platformVersion || caps.browser_version
        const platform = caps.os ? (caps.os + ' ' + caps.os_version) : (caps.platform || caps.platformName)

        /**
         * mobile capabilities
         */
        if (device) {
            const program = (caps.app || '').replace('sauce-storage:', '') || caps.browserName
            const executing = program ? `executing ${program}` : ''

            if (!verbose) {
                return `${device} ${platform} ${version}`
            }

            return `${device} on ${platform} ${version} ${executing}`.trim()
        }

        if (!verbose) {
            return (browser + ' ' + (version || '') + ' ' + (platform || '')).trim()
        }

        return browser + (version ? ` (v${version})` : '') + (platform ? ` on ${platform}` : '')
    }

    getResultList (cid, suites, preface = '') {
        let output = ''

        for (const specUid in suites) {
            // Remove "before all" tests from the displayed results
            if (specUid.indexOf('"before all"') === 0) {
                continue
            }

            const spec = suites[specUid]
            const indent = this.indent(cid, specUid)
            const specTitle = suites[specUid].title

            if (specUid.indexOf('"before all"') !== 0) {
                output += `${preface} ${indent}${specTitle}\n`
            }

            for (const testUid in spec.tests) {
                const test = spec.tests[testUid]
                // const testTitle = spec.tests[testUid].title

                if (test.state === '') {
                    continue
                }

                output += this.getTestResult(cid, specUid, test, preface)
                output += '\n'
            }

            output += preface.trim() + '\n'
        }

        return output
    }

    getSuiteHeader (suite) {
        const indent = this.indent(this.context.cid, suite.uid)
        const specTitle = suite.title
        let output = ''
        output += `${this.context.preface} \n${this.context.preface} ${indent}${specTitle}`
        return output
    }

    printSuiteHeader (suite) {
        console.log(this.getSuiteHeader(suite))
    }

    getTestResult (cid, uid, test, preface) {
        let output = ''
        output += preface
        output += '   ' + this.indent(cid, uid)
        output += this.baseReporter.color(this.getColor(test.state), this.getSymbol(test.state))
        output += ' ' + test.title
        return output
    }

    printTestResult (suite, test) {
        console.log(this.getTestResult(suite.cid, suite.uid, test, this.context.preface))
    }

    getSummaryFooter (runner) {
        const cid = runner.cid
        const stats = this.baseReporter.stats
        const results = stats.runners[cid]
        const spec = results.specs[stats.getSpecHash(this.context.runner)]

        let output = ''
        output += `${this.context.preface}\n${this.context.preface}\n`
        output += this.getSummary(this.results[cid], spec._duration, this.context.preface)
        output += `${this.context.preface}\n`
        return output
    }

    printSummaryFooter (runner) {
        console.log(this.getSummaryFooter(runner))
    }

    getSummary (states, duration, preface = '') {
        let output = ''
        let displayedDuration = false

        for (const state in states) {
            const testCount = states[state]
            let testDuration = ''

            /**
             * don't display 0 passing/pending of failing test label
             */
            if (testCount === 0) {
                continue
            }

            /**
             * set duration
             */
            if (!displayedDuration) {
                testDuration = ' (' + this.shortEnglishHumanizer(duration, DURATION_OPTIONS) + ')'
            }

            output += preface + ' '
            output += this.baseReporter.color(this.getColor(state), testCount)
            output += ' ' + this.baseReporter.color(this.getColor(state), state)
            output += testDuration
            output += '\n'
            displayedDuration = true
        }

        return output
    }

    getFailureList (failures, preface) {
        let output = ''

        failures.forEach((test, i) => {
            const title = typeof test.parent !== 'undefined' ? test.parent + ' ' + test.title : test.title
            output += `${preface.trim()}\n`
            output += preface + ' ' + this.baseReporter.color('error title', `${(i + 1)}) ${title}:`) + '\n'
            output += preface + ' ' + this.baseReporter.color('error message', test.err.message) + '\n'
            if (test.err.stack) {
                const stack = test.err.stack.split(/\n/g).map((l) => `${preface} ${this.baseReporter.color('error stack', l)}`).join('\n')
                output += `${stack}\n`
            } else {
                output += `${preface} ${this.baseReporter.color('error stack', 'no stack available')}\n`
            }
        })

        return output
    }

    getJobLink (results, preface) {
        if (!results.config.host) {
            return ''
        }

        let output = ''
        if (results.config.host.indexOf('saucelabs.com') > -1) {
            output += `${preface.trim()}\n`
            output += `${preface} Check out job at https://saucelabs.com/tests/${results.sessionID}\n`
            return output
        }

        return output
    }

    getHeader (runner) {
        this.context.cid = runner.cid
        const stats = this.baseReporter.stats
        const results = stats.runners[this.context.cid]
        this.context.preface = `[${this.getBrowserCombo(results.capabilities, false)} #${this.context.cid}]`
        const combo = this.getBrowserCombo(results.capabilities)

        let output = ''
        output += '------------------------------------------------------------------\n'
        output += `${this.context.preface} Session ID: ${results.sessionID}\n`
        output += `${this.context.preface} Spec: ${this.specs[this.context.cid]}\n`
        output += `${this.context.preface} Running: ${combo}`
        return output
    }

    printHeader (runner) {
        this.context.headerPrinted = true
        console.log(this.getHeader(runner))
    }

    getSuiteResult (runner) {
        const cid = runner.cid
        const stats = this.baseReporter.stats
        const results = stats.runners[cid]
        const preface = `[${this.getBrowserCombo(results.capabilities, false)} #${cid}]`
        const specHash = stats.getSpecHash(runner)
        const spec = results.specs[specHash]
        const failures = stats.getFailures().filter((f) => f.cid === cid || Object.keys(f.runner).indexOf(cid) > -1)

        /**
         * don't print anything if no specs where executed
         */
        if (Object.keys(spec.suites).length === 0) {
            return ''
        }

        this.errorCount = 0
        let output = ''
        output += this.getHeader(runner)
        output += `\n${preface}\n`
        output += this.getResultList(cid, spec.suites, preface)
        output += `${preface}\n`
        output += this.getSummary(this.results[cid], spec._duration, preface)
        output += this.getFailureList(failures, preface)
        output += this.getJobLink(results, preface)
        output += `${preface}\n`
        return output
    }

    printSuiteResult (runner) {
        console.log(this.getSuiteResult(runner))
    }

    getSuitesSummary (specCount) {
        let output = '\n\n==================================================================\n'
        output += 'Number of specs: ' + specCount
        return output
    }

    printSuitesSummary () {
        const specCount = Object.keys(this.baseReporter.stats.runners).length

        /**
         * no need to print summary if only one runner was executed
         */
        if (specCount === 1) {
            return
        }

        const epilogue = this.baseReporter.epilogue
        console.log(this.getSuitesSummary(specCount))
        epilogue.call(this.baseReporter)
    }
}

export default SpecReporter
