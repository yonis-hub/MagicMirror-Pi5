/* MagicMirror² Config Sample
 *
 * By Michael Teeuw https://michaelteeuw.nl
 * MIT Licensed.
 *
 * For more information on how you can configure this file
 * see https://docs.magicmirror.builders/configuration/introduction.html
 * and https://docs.magicmirror.builders/modules/configuration.html
 *
 * You can use environment variables using a `config.js.template` file instead of `config.js`
 * which will be converted to `config.js` while starting. For more information
 * see https://docs.magicmirror.builders/configuration/introduction.html#enviromnent-variables
 */
let config = {
	address: "localhost", // Address to listen on, can be:
	// - "localhost", "127.0.0.1", "::1" to listen on loopback interface
	// - another specific IPv4/6 to listen on a specific interface
	// - "0.0.0.0", "::" to listen on any interface
	// Default, when address config is left out or empty, is "localhost"
	port: 8080,
	basePath: "/", // The URL path where MagicMirror² is hosted. If you are using a Reverse proxy
	// you must set the sub path here. basePath must end with a /
	ipWhitelist: ["127.0.0.1", "::ffff:127.0.0.1", "::1"], // Set [] to allow all IP addresses
	// or add a specific IPv4 of 192.168.1.5 :
	// ["127.0.0.1", "::ffff:127.0.0.1", "::1", "::ffff:192.168.1.5"],
	// or IPv4 range of 192.168.3.0 --> 192.168.3.15 use CIDR format :
	// ["127.0.0.1", "::ffff:127.0.0.1", "::1", "::ffff:192.168.3.0/28"],

	useHttps: false, // Support HTTPS or not, default "false" will use HTTP
	httpsPrivateKey: "", // HTTPS private key path, only require when useHttps is true
	httpsCertificate: "", // HTTPS Certificate path, only require when useHttps is true

	language: "en",
	locale: "en-US",
	logLevel: ["INFO", "LOG", "WARN", "ERROR"], // Add "DEBUG" for even more logging
	timeFormat: 24,
	units: "metric",

	modules: [
		{
			module: "alert"
		},
		{
			module: "updatenotification",
			position: "top_bar"
		},
		{
			module: "MMM-MyPrayerTimes",
			position: "top_left",
			header: "Prayer Times",
			config: {
				mptLat: 43.6532, // Toronto, Canada
				mptLon: -79.3832, // Toronto, Canada
				mptMethod: 2, // 2 = Islamic Society of North America (ISNA)
				mptOffset: "0,0,0,0,0,0,0,0,0",
				showSunrise: false,
				showSunset: false,
				showMidnight: false,
				showImsak: false,
				show24Clock: false, // 12-hour format with AM/PM
				showOnlyNext: true // Show only the next prayer time
			}
		},
		{
			module: "clock",
			position: "top_left"
		},
		{
			module: "calendar",
			header: "Holidays",
			position: "top_left",
			config: {
				maximumEntries: 5,
				calendars: [
					{
						symbol: "calendar-check",
						url: "https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics"
					},
					{
						symbol: "moon",
						url: "https://calendar.google.com/calendar/ical/en.islamic%23holiday%40group.v.calendar.google.com/public/basic.ics",
						color: "#90EE90"
					}
				]
			}
		},
		{
			module: "compliments",
			position: "lower_third"
		},
		{
			module: "weather",
			position: "top_right",
			config: {
				weatherProvider: "openweathermap",
				type: "current",
				location: "London, Ontario",
				locationID: "6058560", // London, Ontario, Canada
				apiKey: "83b14ba81eb9656f4afafb0637abf5e5",
				convertTemperature: true,
				showWindDirection: true,
				showWindDirectionAsArrow: true,
				showHumidity: true,
				showSun: true,
				showWeekdayForecasts: true,
				fadePoint: 0.25
			}
		},
		{
			module: "weather",
			position: "top_right",
			header: "Weather Forecast",
			config: {
				weatherProvider: "openweathermap",
				type: "forecast",
				location: "London, Ontario",
				locationID: "6058560", // London, Ontario, Canada
				apiKey: "83b14ba81eb9656f4afafb0637abf5e5"
			}
		},
		{
			module: "newsfeed",
			position: "bottom_right",
			header: "News Feed",
			config: {
				feeds: [
					// Technology News
					{
						title: "TechCrunch",
						url: "https://techcrunch.com/feed/"
					},
					// World News
					{
						title: "BBC World",
						url: "https://feeds.bbci.co.uk/news/world/rss.xml"
					}
					// Add more news sources by uncommenting below

					// Business News
					// ,{
					// 	title: "Financial Times",
					// 	url: "https://www.ft.com/rss/home"
					// }

					// Science News
					// ,{
					// 	title: "National Geographic",
					// 	url: "https://feeds.nationalgeographic.com/ng/News/News_Main"
					// }
				],
				showSourceTitle: true,
				showPublishDate: true,
				broadcastNewsFeeds: true,
				broadcastNewsUpdates: true,
				showDescription: true,
				lengthDescription: 150
			}
		},
		{
			module: "MMM-QuranEmbed",
			position: "top_center",
			config: {
				height: "600px",
				width: "100%",
				showControls: true,
				useAPI: true,
				clientId: "ef8785ea-8976-4fe3-9009-fbfa64fe544b",
				clientSecret: "4O-HX00pK6hgnEI9JlndwFMI.q"
			}
		},
		{
			module: "MMM-WebSpeechTTS",
			position: "middle_center", // Make it more visible in the center
			config: {
				hidden: false, // Set to false to see the text that should be spoken
				text: "TTS Ready - Press G for greeting, T for time", // Custom placeholder text
				speechLang: "en-US",
				speechVoice: "", // Will auto-select first available voice
				speechRate: 1,
				speechPitch: 1,
				speechVolume: 1,
				translationLang: "",
				producers: {
					greeting: {
						enabled: true,
						delay: 2000 // Reduced delay to hear it sooner
					},
					keyboard: {
						enabled: true,
						shortcuts: {
							greeting: "g",
							stop: "s",
							time: "t"
						}
					},
					publicTransport: {
						enabled: false,
						shortcut: "d"
					}
				}
			},
			scripts: ["modules/MMM-WebSpeechTTS/custom.js"] // Add our custom test script
		},
		{
			module: "MMM-MyScoreboard",
			position: "bottom_left",
			config: {
				viewStyle: "oneLineWithLogos",
				showPlayoffStatus: true,
				rolloverHours: 0,
				sports: [{ league: "NBA" }],
				maxHeight: 200
			}
		}
	]
};

/*************** DO NOT EDIT THE LINE BELOW ***************/
if (typeof module !== "undefined") {
	module.exports = config;
}
