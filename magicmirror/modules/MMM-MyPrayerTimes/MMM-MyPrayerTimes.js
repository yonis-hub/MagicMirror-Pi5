/*
//-------------------------------------------
MMM-MyPrayerTime
Copyright (C) 2024 - H. Tilburgs
MIT License
//-------------------------------------------
*/

Module.register("MMM-MyPrayerTimes", {
  // Default values
  defaults: {
    mptLat: null,
    mptLon: null,
    mptMethod: 3,
    mptOffset: "0,0,0,0,0,0,0,0,0",
    showSunrise: true,
    showSunset: true,
    showMidnight: true,
    showImsak: true,
    show24Clock: true,
    showOnlyNext: false,
    showHijriDate: true,
    maxWidth: "500px",
    animationSpeed: 1000,
    initialLoadDelay: 1000,
    retryDelay: 2500,
    updateInterval: 60 * 60 * 1000,
    // Adhan audio settings
    playAdhan: true,
    adhanFile: "modules/MMM-MyPrayerTimes/adaan.mp3",
    adhanVolume: 0.8,
    adhanPrayers: ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"]
  },

  // Define required files
  getStyles: function () {
    return ["MMM-MyPrayerTimes.css"];
  },
  getScripts: function () {
    return ["moment.js"];
  },
  getTranslations: function () {
    return {
      en: "translations/en.json",
      nl: "translations/nl.json",
      tr: "translations/tr.json"
    };
  },

  start: function () {
    Log.info(`Starting module: ${this.name}`);
    const now = new Date();
    const dateStr = `${now.getDate().toString().padStart(2, "0")}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${now.getFullYear()}`;
    this.url =
      `https://api.aladhan.com/v1/timings/${dateStr}` +
      `?latitude=${this.config.mptLat}` +
      `&longitude=${this.config.mptLon}` +
      `&method=${this.config.mptMethod}` +
      `&tune=${this.config.mptOffset}`;
    this.MPT = {};
    this.hijriDate = null;
    this.loaded = false;
    this.playedAdhanToday = {};
    this.adhanAudio = null;
    this.scheduleUpdate();
    if (this.config.playAdhan) {
      this.scheduleAdhanCheck();
    }
  },

  scheduleAdhanCheck: function () {
    setInterval(() => this.checkAdhanTime(), 30000);
  },

  checkAdhanTime: function () {
    if (!this.loaded || !this.config.playAdhan) return;

    const now = new Date();
    const currentTime =
      `${now.getHours().toString().padStart(2, "0")}:` +
      `${now.getMinutes().toString().padStart(2, "0")}`;

    for (const prayerKey of this.config.adhanPrayers) {
      const prayerTime = this.MPT[prayerKey];
      if (!prayerTime) continue;

      const todayKey = `${now.toDateString()}-${prayerKey}`;
      if (this.playedAdhanToday[todayKey]) continue;

      if (prayerTime === currentTime) {
        Log.info(`MMM-MyPrayerTimes: Playing Adhan for ${prayerKey}`);
        this.playAdhan();
        this.playedAdhanToday[todayKey] = true;
      }
    }
  },

  playAdhan: function () {
    if (this.adhanAudio) {
      this.adhanAudio.pause();
    }
    this.adhanAudio = new Audio(this.config.adhanFile);
    this.adhanAudio.volume = this.config.adhanVolume;
    this.adhanAudio.play().catch((error) => {
      Log.error(`MMM-MyPrayerTimes: Error playing Adhan: ${error}`);
    });
  },

  getDom: function () {
    const wrapper = document.createElement("div");
    wrapper.className = "wrapper";
    wrapper.style.maxWidth = this.config.maxWidth;

    if (!this.loaded) {
      wrapper.innerHTML = "Loading....";
      wrapper.classList.add("bright", "light", "small");
      return wrapper;
    }

    // Display Hijri Date
    if (this.config.showHijriDate && this.hijriDate) {
      const hijriDiv = document.createElement("div");
      hijriDiv.className = "hijri-date bright";
      const hijriText = `${this.hijriDate.day} ${this.hijriDate.month.en}, ${this.hijriDate.year} AH`;
      const hijriArabic = `${this.hijriDate.month.ar} ${this.hijriDate.day}، ${this.hijriDate.year}`;
      hijriDiv.innerHTML = `<span class="hijri-en">${hijriText}</span><br><span class="hijri-ar dimmed">${hijriArabic}</span>`;
      wrapper.appendChild(hijriDiv);
    }

    const table = document.createElement("table");
    table.className = "small";

    let prayerTimes = [
      {
        key: "Imsak",
        label: "IMSAK",
        arabic: "الإمساك",
        show: this.config.showImsak
      },
      { key: "Fajr", label: "FAJR", arabic: "الفجر" },
      {
        key: "Sunrise",
        label: "SUNRISE",
        arabic: "شروق الشمس",
        show: this.config.showSunrise
      },
      { key: "Dhuhr", label: "DHUHR", arabic: "الظهر" },
      { key: "Asr", label: "ASR", arabic: "العصر" },
      {
        key: "Sunset",
        label: "SUNSET",
        arabic: "غروب الشمس",
        show: this.config.showSunset
      },
      { key: "Maghrib", label: "MAGHRIB", arabic: "المغرب" },
      { key: "Isha", label: "ISHA", arabic: "العشاء" },
      {
        key: "Midnight",
        label: "MIDNIGHT",
        arabic: "منتصف الليل",
        show: this.config.showMidnight
      }
    ];

    // Filter to show only next prayer if configured
    if (this.config.showOnlyNext) {
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      // Find the next prayer
      let nextPrayer = null;
      for (const prayer of prayerTimes) {
        if (prayer.show === false) continue;
        const timeStr = this.MPT[prayer.key];
        if (!timeStr) continue;
        const [hours, minutes] = timeStr.split(":").map(Number);
        const prayerMinutes = hours * 60 + minutes;
        if (prayerMinutes > currentMinutes) {
          nextPrayer = prayer;
          break;
        }
      }
      // If no next prayer found today, show first prayer (Fajr tomorrow)
      if (!nextPrayer) {
        nextPrayer = prayerTimes.find((p) => p.key === "Fajr");
      }
      prayerTimes = nextPrayer ? [nextPrayer] : [];
    }

    prayerTimes.forEach((prayer) => {
      if (prayer.show === false) return;
      const row = this.createPrayerRow(
        prayer.label,
        this.MPT[prayer.key],
        prayer.arabic
      );
      table.appendChild(row);
    });

    wrapper.appendChild(table);
    return wrapper;
  },

  createPrayerRow: function (label, time, arabicText) {
    const row = document.createElement("tr");

    const textCell = document.createElement("td");
    textCell.className = `${label.toLowerCase()}-text`;
    textCell.innerHTML = this.translate(label);
    row.appendChild(textCell);

    const timeCell = document.createElement("td");
    timeCell.className = `${label.toLowerCase()}-time bright`;
    timeCell.innerHTML = this.config.show24Clock
      ? time
      : this.convert24Time(time);
    row.appendChild(timeCell);

    const arabicCell = document.createElement("td");
    arabicCell.className = `${label.toLowerCase()}-arab`;
    arabicCell.innerHTML = arabicText;
    row.appendChild(arabicCell);

    return row;
  },

  convert24Time: function (time) {
    const match = time
      .toString()
      .match(/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/);
    if (!match) return time;

    let [hours, minutes] = match.slice(1, 3);
    const suffix = hours < 12 ? " AM" : " PM";
    hours = hours % 12 || 12;

    return `${hours}:${minutes}${suffix}`;
  },

  processMPT: function (data) {
    this.MPT = data.timings;
    this.hijriDate = data.hijri;
    this.loaded = true;
  },

  scheduleUpdate: function () {
    setInterval(() => this.getMPT(), this.config.updateInterval);
    this.getMPT();
  },

  getMPT: function () {
    this.sendSocketNotification("GET_MPT", this.url);
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "MPT_RESULT") {
      this.processMPT(payload);
      this.updateDom(this.config.animationSpeed);
    }
  }
});
