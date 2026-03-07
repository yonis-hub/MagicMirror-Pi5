/* Magic Mirror
 * Module: MMM-BismillahBanner
 * Static Arabic banner for top bar placement
 * MIT Licensed.
 */

Module.register("MMM-BismillahBanner", {
	defaults: {
		arabicText: "\u0628\u0650\u0633\u0652\u0645\u0650 \u0671\u0644\u0644\u0647\u0650 \u0671\u0644\u0631\u064e\u0651\u062d\u0652\u0645\u0670\u0646\u0650 \u0671\u0644\u0631\u064e\u0651\u062d\u0650\u064a\u0652\u0645\u0650",
		ligatureText: "\uFDFD",
		showLigature: false,
		showTransliteration: false,
		transliteration: "Bismillah ir-Rahman ir-Rahim"
	},

	getStyles: function () {
		return [this.file("MMM-BismillahBanner.css")];
	},

	getDom: function () {
		const wrapper = document.createElement("div");
		wrapper.className = "mmm-bismillah-banner";

		const arabic = document.createElement("div");
		arabic.className = "bismillah-arabic";
		arabic.textContent = this.config.arabicText;
		wrapper.appendChild(arabic);

		if (this.config.showLigature) {
			const ligature = document.createElement("div");
			ligature.className = "bismillah-ligature";
			ligature.textContent = this.config.ligatureText;
			wrapper.appendChild(ligature);
		}

		if (this.config.showTransliteration) {
			const transliteration = document.createElement("div");
			transliteration.className = "bismillah-transliteration";
			transliteration.textContent = this.config.transliteration;
			wrapper.appendChild(transliteration);
		}

		return wrapper;
	}
});
