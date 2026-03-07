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
		transliteration: "Bismillah ir-Rahman ir-Rahim",
		stylePreset: "classical-naskh",
		fontScale: 1.25,
		textColor: "#ffffff"
	},

	getStyles: function () {
		return [this.file("MMM-BismillahBanner.css")];
	},

	getStylePresets: function () {
		return {
			"classical-naskh": {
				arabicFontFamily: "\"Amiri\", \"Scheherazade New\", \"Noto Naskh Arabic\", \"Traditional Arabic\", serif",
				ligatureFontFamily: "\"Amiri\", \"Scheherazade New\", \"Noto Naskh Arabic\", \"Traditional Arabic\", serif"
			},
			thuluth: {
				arabicFontFamily: "\"Aref Ruqaa\", \"Scheherazade New\", \"Noto Naskh Arabic\", \"Traditional Arabic\", serif",
				ligatureFontFamily: "\"Aref Ruqaa\", \"Scheherazade New\", \"Noto Naskh Arabic\", \"Traditional Arabic\", serif"
			},
			compact: {
				arabicFontFamily: "\"Noto Naskh Arabic\", \"Scheherazade New\", \"Amiri\", \"Traditional Arabic\", serif",
				ligatureFontFamily: "\"Noto Naskh Arabic\", \"Scheherazade New\", \"Amiri\", \"Traditional Arabic\", serif"
			}
		};
	},

	resolveStylePreset: function () {
		const presets = this.getStylePresets();
		const key = String(this.config.stylePreset || "").trim().toLowerCase();
		return presets[key] || presets["classical-naskh"];
	},

	getDom: function () {
		const wrapper = document.createElement("div");
		wrapper.className = "mmm-bismillah-banner";

		const safeScale = Number.isFinite(Number(this.config.fontScale)) ? Number(this.config.fontScale) : 1.25;
		const stylePreset = this.resolveStylePreset();
		wrapper.style.setProperty("--bismillah-font-scale", String(Math.max(0.5, safeScale)));
		wrapper.style.setProperty("--bismillah-text-color", String(this.config.textColor || "#ffffff"));
		wrapper.style.setProperty("--bismillah-arabic-font-family", stylePreset.arabicFontFamily);
		wrapper.style.setProperty("--bismillah-ligature-font-family", stylePreset.ligatureFontFamily);

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
