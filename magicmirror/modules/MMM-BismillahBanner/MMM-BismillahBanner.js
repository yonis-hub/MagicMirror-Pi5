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
		// Module-relative by default so the banner never depends on the network.
		// A remote http(s) URL still works if one is configured, but a fetch
		// failure there silently degrades the banner to the plain text block.
		imageUrl: "assets/bismillah.svg",
		// Retry a failed image load before giving up on it for good; without
		// this a single transient failure at page load stuck the banner in the
		// text fallback until the next Chromium restart.
		imageRetryCount: 4,
		imageRetryDelayMs: 3000,
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

	// Absolute URLs (remote or server-root) are used as-is; anything else is
	// treated as a path inside this module folder and served by MagicMirror.
	resolveImageUrl: function () {
		const raw = String(this.config.imageUrl || "").trim();
		if (!raw) {
			return "";
		}
		if (/^(https?:)?\/\//i.test(raw) || raw.startsWith("/")) {
			return raw;
		}
		return this.file(raw);
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
		const imageUrl = this.resolveImageUrl();
		if (wantsImage && imageUrl) {
			const imageWrap = document.createElement("div");
			imageWrap.className = "bismillah-image-wrap";

			const image = document.createElement("img");
			image.className = "bismillah-image";
			image.alt = "Bismillah calligraphy";

			const maxRetries = Math.max(0, Number(this.config.imageRetryCount) || 0);
			const retryDelay = Math.max(250, Number(this.config.imageRetryDelayMs) || 3000);
			let attempt = 0;

			image.addEventListener("error", () => {
				if (attempt < maxRetries) {
					attempt += 1;
					Log.warn(`MMM-BismillahBanner: image load failed, retry ${attempt}/${maxRetries} in ${retryDelay * attempt}ms`);
					// Cache-bust so a cached failure response isn't replayed.
					setTimeout(() => {
						image.src = `${imageUrl}${imageUrl.includes("?") ? "&" : "?"}retry=${attempt}`;
					}, retryDelay * attempt);
					return;
				}
				Log.error("MMM-BismillahBanner: image unavailable, falling back to text");
				imageWrap.remove();
				wrapper.appendChild(this.buildTextBlock(stylePreset));
			});

			image.src = imageUrl;
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
