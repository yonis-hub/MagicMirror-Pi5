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
		renderMode: "image",
		imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Bismillah_Calligraphy6.svg",
		imageWidthPx: 380,
		imageFilter: "brightness(0) saturate(100%) invert(64%) sepia(55%) saturate(562%) hue-rotate(80deg) brightness(98%) contrast(90%)",
		imageBackgroundColor: "#000000",
		imagePaddingPx: 0,
		imageBorderRadiusPx: 0,
		stylePreset: "classical-naskh",
		fontScale: 1.25,
		textColor: "#7be38d"
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

	buildTextBlock: function (stylePreset) {
		const block = document.createElement("div");
		block.className = "bismillah-text-block";

		const arabic = document.createElement("div");
		arabic.className = "bismillah-arabic";
		arabic.textContent = this.config.arabicText;
		block.appendChild(arabic);

		if (this.config.showLigature) {
			const ligature = document.createElement("div");
			ligature.className = "bismillah-ligature";
			ligature.textContent = this.config.ligatureText;
			block.appendChild(ligature);
		}

		if (this.config.showTransliteration) {
			const transliteration = document.createElement("div");
			transliteration.className = "bismillah-transliteration";
			transliteration.textContent = this.config.transliteration;
			block.appendChild(transliteration);
		}

		block.style.setProperty("--bismillah-arabic-font-family", stylePreset.arabicFontFamily);
		block.style.setProperty("--bismillah-ligature-font-family", stylePreset.ligatureFontFamily);
		return block;
	},

	getDom: function () {
		const wrapper = document.createElement("div");
		wrapper.className = "mmm-bismillah-banner";

		const safeScale = Number.isFinite(Number(this.config.fontScale)) ? Number(this.config.fontScale) : 1.25;
		const stylePreset = this.resolveStylePreset();
		wrapper.style.setProperty("--bismillah-font-scale", String(Math.max(0.5, safeScale)));
		wrapper.style.setProperty("--bismillah-text-color", String(this.config.textColor || "#7be38d"));
		wrapper.style.setProperty("--bismillah-image-width", `${Math.max(180, Number(this.config.imageWidthPx) || 380)}px`);
		wrapper.style.setProperty("--bismillah-image-filter", String(this.config.imageFilter || ""));
		wrapper.style.setProperty("--bismillah-image-bg", String(this.config.imageBackgroundColor || "#000000"));
		wrapper.style.setProperty("--bismillah-image-padding", `${Math.max(0, Number(this.config.imagePaddingPx) || 8)}px`);
		wrapper.style.setProperty("--bismillah-image-radius", `${Math.max(0, Number(this.config.imageBorderRadiusPx) || 8)}px`);
		wrapper.style.setProperty("--bismillah-arabic-font-family", stylePreset.arabicFontFamily);
		wrapper.style.setProperty("--bismillah-ligature-font-family", stylePreset.ligatureFontFamily);

		const wantsImage = String(this.config.renderMode || "").trim().toLowerCase() === "image";
		const imageUrl = String(this.config.imageUrl || "").trim();
		if (wantsImage && imageUrl) {
			const imageWrap = document.createElement("div");
			imageWrap.className = "bismillah-image-wrap";

			const image = document.createElement("img");
			image.className = "bismillah-image";
			image.alt = "Bismillah calligraphy";
			image.src = imageUrl;

			image.addEventListener("error", () => {
				imageWrap.remove();
				wrapper.appendChild(this.buildTextBlock(stylePreset));
			});

			imageWrap.appendChild(image);
			wrapper.appendChild(imageWrap);

			if (this.config.showTransliteration) {
				const transliteration = document.createElement("div");
				transliteration.className = "bismillah-transliteration";
				transliteration.textContent = this.config.transliteration;
				wrapper.appendChild(transliteration);
			}
		} else {
			wrapper.appendChild(this.buildTextBlock(stylePreset));
		}

		return wrapper;
	}
});
