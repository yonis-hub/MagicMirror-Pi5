/* Magic Mirror
 * Module: MMM-QuranEmbed
 *
 * By Your Name
 * MIT Licensed.
 */

Module.register("MMM-QuranEmbed", {
    // Default module config.
    defaults: {
        apiVersion: '1.0',
        showArabic: true,
        showTranslation: true,
        surahArabicName: false,
        translationLang: 'en.sahih', // translation language
        updateInterval: 3600 * 1000, // How often to fetch new verse if random mode is enabled (milliseconds)
        animationSpeed: 2.5 * 1000, // Speed of the update animation (milliseconds)
        randomVerse: false,    // Whether to display random verses or a specific surah
        chapterId: 1,          // Default surah/chapter to show (Al-Fatiha)
        verseNumber: null,     // Specific verse number (null to show all verses in the surah)
        verseRange: null,      // Optional verse range, e.g. '1-7' for verses 1-7
        voiceControlled: true, // Whether this module responds to voice commands
        useAPI: true,         // Always use API mode for cleaner display
        clientId: "",        // Your Quran Foundation API client ID
        clientSecret: ""      // Your Quran Foundation API client secret
    },

    // Surah name mapping for voice commands
    surahNames: {
        "fatiha": 1, "baqara": 2, "imran": 3, "nisa": 4, "maida": 5,
        "anam": 6, "araf": 7, "anfal": 8, "tawba": 9, "yunus": 10,
        "hud": 11, "yusuf": 12, "rad": 13, "ibrahim": 14, "hijr": 15,
        "nahl": 16, "isra": 17, "kahf": 18, "maryam": 19, "taha": 20,
        "anbiya": 21, "hajj": 22, "muminun": 23, "nur": 24, "furqan": 25,
        "shuara": 26, "naml": 27, "qasas": 28, "ankabut": 29, "rum": 30,
        "luqman": 31, "sajda": 32, "ahzab": 33, "saba": 34, "fatir": 35,
        "yasin": 36, "saffat": 37, "sad": 38, "zumar": 39, "ghafir": 40,
        "fussilat": 41, "shura": 42, "zukhruf": 43, "dukhan": 44, "jathiya": 45,
        "ahqaf": 46, "muhammad": 47, "fath": 48, "hujurat": 49, "qaf": 50,
        "dhariyat": 51, "tur": 52, "najm": 53, "qamar": 54, "rahman": 55,
        "waqia": 56, "hadid": 57, "mujadila": 58, "hashr": 59, "mumtahina": 60,
        "saff": 61, "jumua": 62, "munafiqun": 63, "taghabun": 64, "talaq": 65,
        "tahrim": 66, "mulk": 67, "qalam": 68, "haqqa": 69, "maarij": 70,
        "nuh": 71, "jinn": 72, "muzzammil": 73, "muddaththir": 74, "qiyama": 75,
        "insan": 76, "mursalat": 77, "naba": 78, "naziat": 79, "abasa": 80,
        "takwir": 81, "infitar": 82, "mutaffifin": 83, "inshiqaq": 84, "buruj": 85,
        "tariq": 86, "ala": 87, "ghashiya": 88, "fajr": 89, "balad": 90,
        "shams": 91, "layl": 92, "duha": 93, "sharh": 94, "tin": 95,
        "alaq": 96, "qadr": 97, "bayyina": 98, "zalzala": 99, "adiyat": 100,
        "qaria": 101, "takathur": 102, "asr": 103, "humaza": 104, "fil": 105,
        "quraysh": 106, "maun": 107, "kawthar": 108, "kafirun": 109, "nasr": 110,
        "masad": 111, "ikhlas": 112, "falaq": 113, "nas": 114
    },

    // Define required scripts
    getScripts: function() {
        return [];
    },

    // Define required styles
    getStyles: function() {
        return [this.file("MMM-QuranEmbed.css")];
    },

    // Define start sequence
    start: function() {
        Log.info("Starting module: " + this.name);
        this.loaded = false;
        this.quranData = null;
        this.currentUrl = this.config.initialUrl;
        this.accessToken = null;
        this.currentVerseIndex = 0;
        this.animationTimer = null;

        // Send configuration to the node helper
        this.sendSocketNotification("MODULE_READY", {
            config: this.config
        });

        // If using the API, request data
        if (this.config.useAPI) {
            this.sendSocketNotification("GET_QURAN_DATA", {
                chapterId: this.config.chapterId,
                verseRange: this.config.verseRange,
                translation: this.config.translation
            });
        }
    },

    // Override dom generator.
    getDom: function() {
        Log.log("Updating MMM-QuranEmbed DOM.");
        const self = this;
        let arabic = "";
        let translation = "";
        let ayahNumberInSurah = "";
        let surahNameArabic = "";
        let surahNameEnglish = "";

        const wrapper = document.createElement("div");
        wrapper.className = "MMM-QuranEmbed";

        if (!this.loaded) {
            wrapper.innerHTML = "<div class='loading'>Loading Quran...</div>";
            return wrapper;
        }

        // Using the simple format like MMM-RandomQuranAyah
        if (this.quranData && this.quranData.verses && this.quranData.verses.length > 0) {
            // Get current verse data
            let currentVerse;
            if (this.config.animateVerses && this.currentVerseIndex < this.quranData.verses.length) {
                currentVerse = this.quranData.verses[this.currentVerseIndex];
            } else {
                // If not animating, just show the first verse
                currentVerse = this.quranData.verses[0];
            }

            // Extract data
            arabic = currentVerse.text_uthmani;
            translation = currentVerse.translations && currentVerse.translations[0] ?
                          currentVerse.translations[0].text : "";
            ayahNumberInSurah = currentVerse.verse_number;
            surahNameArabic = this.quranData.chapter ? this.quranData.chapter.name_arabic : "";
            surahNameEnglish = this.quranData.chapter && this.quranData.chapter.translated_name ?
                               this.quranData.chapter.translated_name.name : "";

            // Create a simple display
            if (self.config.showArabic) {
                const txtArabic = document.createElement("div");
                txtArabic.className = "txt-arabic bright medium light";
                txtArabic.innerHTML = arabic;
                wrapper.appendChild(txtArabic);
            }

            const txtTranslation = document.createElement("div");
            txtTranslation.className = "txt-translation bright small light";
            let htmlRef = "";
            if (self.config.surahArabicName) {
                htmlRef = surahNameArabic + ":" + ayahNumberInSurah;
            } else {
                htmlRef = "QS. " + surahNameEnglish + ":" + ayahNumberInSurah;
            }

            if (self.config.showTranslation) {
                txtTranslation.innerHTML = translation + " (" + htmlRef + ")";
            } else {
                txtTranslation.innerHTML = "(" + htmlRef + ")";
            }
            wrapper.appendChild(txtTranslation);
        }
        else if (this.config.displayMode === "iframe" && !this.config.useAPI) {
            // Fallback to iframe if API data isn't available
            const iframe = document.createElement("iframe");
            iframe.src = this.currentUrl || "https://quran.com";
            iframe.style.width = "100%";
            iframe.style.height = "100%";
            iframe.style.border = "none";
            iframe.scrolling = "no";
            wrapper.appendChild(iframe);
        }
        else {
            wrapper.className = "bright small light";
            wrapper.innerHTML = this.translate("LOADING");
        }

        return wrapper;
    },

    // Helper function to create verse elements
    createVerseElement: function(verse, isActive = false) {
        const verseElement = document.createElement("div");
        verseElement.className = isActive ? "verse active" : "verse";

        // Add verse number badge if in non-animated mode
        if (!isActive || !this.config.animateVerses) {
            const verseNumber = document.createElement("div");
            verseNumber.className = "verse-number";
            verseNumber.textContent = verse.verse_number;
            verseElement.appendChild(verseNumber);
        }

        // Arabic text - large and beautiful
        const arabicText = document.createElement("div");
        arabicText.className = "arabic-text";
        arabicText.innerHTML = verse.text_uthmani;
        verseElement.appendChild(arabicText);

        // Add translation if available and enabled
        if (this.config.showTranslation && verse.translations && verse.translations.length > 0) {
            const translationText = document.createElement("div");
            translationText.className = "translation-text";
            translationText.textContent = verse.translations[0].text;
            verseElement.appendChild(translationText);
        }

        return verseElement;
    },

    // Helper to animate through verses when in animation mode
    startVerseAnimation: function() {
        if (this.animationTimer) {
            clearInterval(this.animationTimer);
        }

        this.currentVerseIndex = 0;

        this.animationTimer = setInterval(() => {
            if (this.quranData && this.quranData.verses) {
                this.currentVerseIndex = (this.currentVerseIndex + 1) % this.quranData.verses.length;
                this.updateDom(500); // Smooth transition
            }
        }, 10000); // Change verse every 10 seconds
    },

    stopVerseAnimation: function() {
        if (this.animationTimer) {
            clearInterval(this.animationTimer);
            this.animationTimer = null;
        }
    },

    // Socket notifications received from the node_helper
    socketNotificationReceived: function(notification, payload) {
        if (notification === "QURAN_URL_UPDATED") {
            this.loaded = true;
            this.currentUrl = payload.url;
            this.updateDom();
            Log.info("MMM-QuranEmbed: Updated URL to " + this.currentUrl);
        } else if (notification === "QURAN_DATA") {
            this.loaded = true;
            this.quranData = payload;
            this.updateDom();
            Log.info("MMM-QuranEmbed: Received Quran data for chapter " + payload.chapter.id);
        } else if (notification === "QURAN_ERROR") {
            this.loaded = true; // Still mark as loaded to display error
            Log.error("MMM-QuranEmbed: Error fetching Quran data: " + payload.message);
        }
    },

    // Override notification handler for voice control commands
    notificationReceived: function(notification, payload, sender) {
        if (notification === "QURAN_EMBED" && payload.url) {
            // Legacy URL-based navigation
            this.loaded = true;
            this.currentUrl = payload.url;
            this.updateDom();
            Log.info("MMM-QuranEmbed: Received notification to update URL to " + this.currentUrl);
        } else if (notification === "QURAN_SHOW_CHAPTER" && payload) {
            // Handle request to show a specific chapter
            let chapterId = payload.chapterId;

            // If a surah name was provided instead of ID, look it up
            if (payload.surahName && !chapterId) {
                const normalizedName = payload.surahName.toLowerCase().trim();
                for (const [name, id] of Object.entries(this.surahNames)) {
                    if (normalizedName.includes(name)) {
                        chapterId = id;
                        break;
                    }
                }
            }

            if (chapterId) {
                if (this.config.useAPI) {
                    // Stop any running animation
                    this.stopVerseAnimation();

                    // Request the chapter data
                    this.sendSocketNotification("GET_QURAN_DATA", {
                        chapterId: chapterId,
                        verseRange: payload.verseRange || this.config.verseRange,
                        translation: payload.translation || this.config.translation
                    });

                    // Start animation if configured
                    if (this.config.animateVerses) {
                        this.startVerseAnimation();
                    }
                } else {
                    // Fallback to iframe mode with quran.com URL
                    const surahUrl = `https://quran.com/${chapterId}`;
                    this.currentUrl = surahUrl;
                    this.loaded = true;
                    this.updateDom();
                }
            }
        } else if (notification === "QURAN_VOICE_COMMAND" && payload && payload.command) {
            // Process voice commands
            const command = payload.command.toLowerCase().trim();

            // Handle various voice command patterns
            if (command.includes("next surah") || command.includes("next chapter")) {
                // Move to the next surah
                const nextChapter = Math.min(114, (this.config.chapterId || 1) + 1);
                this.config.chapterId = nextChapter;
                this.notificationReceived("QURAN_SHOW_CHAPTER", { chapterId: nextChapter });
            }
            else if (command.includes("previous surah") || command.includes("previous chapter")) {
                // Move to the previous surah
                const prevChapter = Math.max(1, (this.config.chapterId || 1) - 1);
                this.config.chapterId = prevChapter;
                this.notificationReceived("QURAN_SHOW_CHAPTER", { chapterId: prevChapter });
            }
            else if (command.includes("show translation")) {
                // Toggle translation on
                this.config.showTranslation = true;
                this.updateDom();
            }
            else if (command.includes("hide translation")) {
                // Toggle translation off
                this.config.showTranslation = false;
                this.updateDom();
            }
            else if (command.includes("animate verses") || command.includes("start animation")) {
                // Start verse animation
                this.config.animateVerses = true;
                this.startVerseAnimation();
                this.updateDom();
            }
            else if (command.includes("stop animation")) {
                // Stop verse animation
                this.config.animateVerses = false;
                this.stopVerseAnimation();
                this.updateDom();
            }
            else {
                // Try to extract surah name or number from command
                let foundSurah = false;

                // Check for surah by number pattern (e.g., "show surah 36")
                const numberMatch = command.match(/surah\s+(\d+)/i);
                if (numberMatch && numberMatch[1]) {
                    const chapterNum = parseInt(numberMatch[1]);
                    if (chapterNum >= 1 && chapterNum <= 114) {
                        this.config.chapterId = chapterNum;
                        this.notificationReceived("QURAN_SHOW_CHAPTER", { chapterId: chapterNum });
                        foundSurah = true;
                    }
                }

                // If no number found, check for surah by name
                if (!foundSurah) {
                    for (const [name, id] of Object.entries(this.surahNames)) {
                        if (command.includes(name)) {
                            this.config.chapterId = id;
                            this.notificationReceived("QURAN_SHOW_CHAPTER", { chapterId: id });
                            foundSurah = true;
                            break;
                        }
                    }
                }
            }
        }
    }
});
