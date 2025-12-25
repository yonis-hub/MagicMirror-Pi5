/* Magic Mirror
 * Node Helper: MMM-QuranEmbed
 *
 * By Your Name
 * MIT Licensed.
 */

const NodeHelper = require("node_helper");
const axios = require("axios");

module.exports = NodeHelper.create({
    start: function() {
        console.log("Starting node helper for: " + this.name);

        // Setup endpoint for receiving URL updates from Python bridge
        this.expressApp.post("/api/module/" + this.name + "/QURAN_EMBED", (req, res) => {
            const url = req.body.url;
            if (url) {
                this.sendSocketNotification("QURAN_URL_UPDATED", { url });
                res.status(200).json({ status: "success", message: "URL updated" });
            } else {
                res.status(400).json({ status: "error", message: "No URL provided" });
            }
        });

        this.config = {};
    },

    // Socket notification received from module
    socketNotificationReceived: async function(notification, payload) {
        console.log("Received notification:", notification);

        if (notification === "MODULE_READY") {
            console.log("MMM-QuranEmbed: Module is ready");
            this.config = payload.config || {};
        }
        else if (notification === "GET_QURAN_DATA") {
            try {
                const { chapterId, verseRange, translation } = payload;
                await this.getQuranData(chapterId, verseRange, translation || "en.sahih");
            } catch (error) {
                console.error("Error in GET_QURAN_DATA:", error);
                this.sendSocketNotification("QURAN_ERROR", { message: error.message });
            }
        }
        // For MMM-RandomQuranAyah compatibility
        else if (notification === "START_QURAN") {
            try {
                this.config = payload;

                // If random verse is requested
                if (payload.randomVerse) {
                    await this.getRandomVerse(payload.translationLang || "en.sahih");
                }
                // Otherwise get a specific chapter
                else if (payload.chapterId) {
                    await this.getQuranData(
                        payload.chapterId,
                        payload.verseRange,
                        payload.translationLang || "en.sahih"
                    );
                }
            } catch (error) {
                console.error("Error in START_QURAN:", error);
                this.sendSocketNotification("QURAN_ERROR", { message: error.message });
            }
        }
    },

    // Get a random verse using alquran.cloud API
    getRandomVerse: async function(translation) {
        try {
            // Choose a random surah (1-114)
            const randomSurah = Math.floor(Math.random() * 114) + 1;

            // Get the surah data
            const surahResponse = await axios.get(`http://api.alquran.cloud/v1/surah/${randomSurah}`);
            const surahData = surahResponse.data.data;

            // Choose a random verse from this surah
            const versesCount = surahData.numberOfAyahs;
            const randomVerse = Math.floor(Math.random() * versesCount) + 1;

            // Fetch the verse in Arabic
            const arabicResponse = await axios.get(`http://api.alquran.cloud/v1/ayah/${randomSurah}:${randomVerse}/quran-uthmani`);
            const arabicText = arabicResponse.data.data.text;

            // Fetch the verse translation
            const translationLang = translation || "en.sahih";
            const translationResponse = await axios.get(`http://api.alquran.cloud/v1/ayah/${randomSurah}:${randomVerse}/${translationLang}`);
            const translationText = translationResponse.data.data.text;

            // Prepare data in the format similar to MMM-RandomQuranAyah
            const quranData = {
                arabic: arabicText,
                translation: translationText,
                ayahNumberInSurah: randomVerse,
                surahNameArabic: surahData.name,
                surahNameEnglish: surahData.englishName,
                surahNumber: randomSurah
            };

            // Send the result back to the module
            this.sendSocketNotification("QURAN_RANDOM_RESULT", quranData);

        } catch (error) {
            console.error("Error fetching random verse:", error.message);
            this.sendSocketNotification("QURAN_ERROR", { message: error.message });
        }
    },

    // Get data for a specific chapter from alquran.cloud API
    getQuranData: async function(chapterId, verseRange, translation) {
        try {
            console.log("Fetching Quran data for surah:", chapterId);

            // Get chapter information
            const chapterResponse = await axios.get(`http://api.alquran.cloud/v1/surah/${chapterId}`);
            const chapterData = chapterResponse.data.data;

            // Get verses in Arabic
            let versesUrl = `http://api.alquran.cloud/v1/surah/${chapterId}/quran-uthmani`;
            const versesResponse = await axios.get(versesUrl);
            let verses = versesResponse.data.data.ayahs;

            // Get verses in translation
            let translationUrl = `http://api.alquran.cloud/v1/surah/${chapterId}/${translation || "en.sahih"}`;
            const translationResponse = await axios.get(translationUrl);
            const translationVerses = translationResponse.data.data.ayahs;

            // Combine Arabic and translation
            verses = verses.map((verse, index) => {
                return {
                    verse_number: verse.numberInSurah,
                    text_uthmani: verse.text,
                    translations: [{
                        text: translationVerses[index].text
                    }]
                };
            });

            // If verse range is specified, filter verses
            if (verseRange) {
                const [start, end] = verseRange.split("-").map(Number);
                verses = verses.filter(verse =>
                    verse.verse_number >= start && verse.verse_number <= end
                );
            }

            // Format the data to match the expected format for the module
            const result = {
                chapter: {
                    id: chapterData.number,
                    name_arabic: chapterData.name,
                    translated_name: {
                        name: chapterData.englishName
                    },
                    bismillah_pre: chapterData.number !== 1 && chapterData.number !== 9
                },
                verses: verses
            };

            // Send the data back to the module
            this.sendSocketNotification("QURAN_DATA", result);
        } catch (error) {
            console.error("Error fetching Quran data:", error.message);
            this.sendSocketNotification("QURAN_ERROR", { message: error.message });
        }
    }
});
