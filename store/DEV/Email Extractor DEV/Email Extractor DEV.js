// Phantombuster configuration {
"phantombuster command: nodejs"
"phantombuster package: 5"
"phantombuster dependencies: lib-StoreUtilities.js"

const Buster = require("phantombuster")
const buster = new Buster()

const Nick = require("nickjs")
const nick = new Nick({
	loadImages: false,
	printPageErrors: false,
	printRessourceErrors: false,
	printNavigation: false,
	printAborts: false,
	debug: false,
})

const StoreUtilities = require("./lib-StoreUtilities")
const utils = new StoreUtilities(nick, buster)
const DB_NAME = "result.csv"
const DEFAULT_WAIT_TIME = 5000
// }

/**
 * @async
 * @description Function used to extract all URLs from buster arguments
 * @param {Array<String>} urls - Buster arguments
 * @return {Promise<Array<String>>} all URLs to scrape
 */
const inflateArguments = async urls => {
	const ret = []
	for (const url of urls) {
		try {
			const tmp = await utils.getDataFromCsv(url, null, false) // Set lib calls quiet
			utils.log(`Getting data from ${url}...`, "loading")
			utils.log(`Got ${tmp.length} lines from csv`, "done")
			ret.push(...tmp)
		} catch (err) {
			ret.push(url)
		}
	}
	return ret
}

const filterUrls = (str, db) => {
	for (const line of db) {
		if (str === line.url) {
			return false
		}
	}
	return true
}

const getUrlsToScrape = (data, pagesPerLaunch) => {
	let i = 0
	const maxLength = data.length
	const urls = []
	if (maxLength === 0) {
		utils.log("Input is empty OR all inputs are already scraped", "warning")
		nick.exit()
	}
	while (i < pagesPerLaunch && i < maxLength) {
		const row = Math.floor(Math.random() * data.length)
		urls.push(data[row])
		data.splice(row, 1)
		i++
	}
	return urls
}

const extractMails = (arg, cb) => {
	const MAIL_REGEX = /[A-Z0-9._%+-]{1,50}@[A-Z0-9.-]{1,50}\.[A-Z]{2,10}/gi
	let data = document.querySelector("html").innerHTML.match(MAIL_REGEX)
	if (Array.isArray(data)) {
		data = data.map(el => el.toLowerCase()).filter(el => !el.match(/.(png|bmp|jpeg|jpg|gif|svg)$/gi))
		data = Array.from(new Set(data)) // Make all emails unique
	} else {
		data = []
	}
	cb(null, data)
}

const scrapeMails = async (tab, url, waitTime) => {
	let result = { mails: [], url }
	try {
		const [ httpCode ] = await tab.open(url)
		if ((httpCode >= 300) || (httpCode < 200)) {
			utils.log(`${url} didn't opened properly got HTTP code ${httpCode}`, "warning")
			result.error = `${url} did'nt opened properly got HTTP code ${httpCode}`
			return result
		}
		await tab.wait(waitTime)
		let mails = await tab.evaluate(extractMails)
		result.mails = mails
	} catch (err) {
		utils.log(`Can't properly open ${url} due to: ${err.message || err}`, "warning")
		result.error = err.message || err
	}
	return result
}

const createCsvOutput = json => {
	const csv = []
	for (const one of json) {
		let csvElement = { url: one.url }

		if (one.error) {
			csvElement.error = one.error
		}

		if (one.mails.length < 1) {
			csvElement.mail = "no mails found"
			csv.push(csvElement)
		} else {
			for (const mail of one.mails) {
				let tmp = Object.assign({}, csvElement)
				tmp.mail = mail
				csv.push(tmp)
			}
		}
	}
	return csv
}

;(async () => {
	let { urls, timeToWait, pagesPerLaunch, queries } = utils.validateArguments()
	const tab = await nick.newTab()
	let db = await utils.getDb(DB_NAME)
	let i = 0

	let scrapingRes = []

	if (typeof urls === "string") {
		urls = [ urls ]
	}

	if (typeof queries === "string") {
		if (Array.isArray(urls)) {
			urls.push(queries)
		} else {
			urls = [ queries ]
		}
	} else if (Array.isArray(queries)) {
		(Array.isArray(urls)) ? urls.push(...queries)  : urls = [ ...queries ]
	}

	if (!timeToWait) {
		timeToWait = DEFAULT_WAIT_TIME
	}

	urls = await inflateArguments(urls)

	if (!pagesPerLaunch) {
		pagesPerLaunch = urls.length
	}

	urls = getUrlsToScrape(urls.filter(el => filterUrls(el, db)), pagesPerLaunch)

	for (const url of urls) {
		utils.log(`Scraping ${url}`, "loading")
		const timeLeft = await utils.checkTimeLeft()
		if (!timeLeft.timeLeft) {
			utils.log(timeLeft.message, "warning")
			break
		}
		buster.progressHint((i + 1) / urls.length, `Scraping: ${url}`)
		const foundMails = await scrapeMails(tab, url, timeToWait)
		scrapingRes = scrapingRes.concat(foundMails)
		utils.log(`Got ${foundMails.mails.length} mails from ${url}`, "done")
		i++
	}

	db = db.concat(createCsvOutput(scrapingRes))

	await utils.saveResults(scrapingRes, db, DB_NAME.split(".").shift(), null, false)
	nick.exit(0)
})()
.catch(err => {
	utils.log(err.message || err, "error")
	nick.exit(1)
})
