/*
//-------------------------------------------
MMM-MyPrayerTimes
Copyright (C) 2024 - H. Tilburgs

v1.0 : Initial version
v2.0 : Update request to fetch (request package has been deprecated)
v2.1 : Optimized code

MIT License
//-------------------------------------------
*/

const NodeHelper = require("node_helper");
const https = require("https");

module.exports = NodeHelper.create({
  start() {
    console.log(`Starting node_helper for: ${this.name}`);
  },

  getMPT(url) {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const result = JSON.parse(data);
          if (result && result.data && result.data.timings) {
            this.sendSocketNotification("MPT_RESULT", {
              timings: result.data.timings,
              hijri: result.data.date && result.data.date.hijri ? result.data.date.hijri : null
            });
          } else {
            console.error("MMM-MyPrayerTimes: Invalid data format received");
          }
        } catch (error) {
          console.error("MMM-MyPrayerTimes: Error parsing JSON", error);
        }
      });
    }).on("error", (error) => {
      console.error("MMM-MyPrayerTimes: Error fetching data", error);
    });
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "GET_MPT") {
      this.getMPT(payload);
    }
  }
});
