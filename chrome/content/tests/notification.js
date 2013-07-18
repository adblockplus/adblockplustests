(function()
{
  let testRunner = null;
  let server = null;
  let randomResult = 0.5;

  let originalApplication;
  let originalAddonVersion;
  let info = require("info");

  module("Notification",
  {
    setup: function()
    {
      testRunner = this;

      preparePrefs.call(this);
      setupVirtualTime.call(this, function(wrapTimer)
      {
        let NotificationModule = getModuleGlobal("notification");
        NotificationModule.downloader._timer = wrapTimer(NotificationModule.downloader._timer);
      }, "notification", "downloader");

      server = new nsHttpServer();
      server.start(1234);

      originalApplication = info.application;
      info.application = "chrome";
      originalAddonVersion = info.addonVersion;
      info.addonVersion = "1.4.1";

      Prefs.notificationurl = "http://127.0.0.1:1234/notification.json";
      Prefs.notificationdata = {};

      // Replace Math.random() function
      let DownloaderGlobal = Cu.getGlobalForObject(getModuleGlobal("downloader"));
      this._origRandom = DownloaderGlobal.Math.random;
      DownloaderGlobal.Math.random = function() randomResult;
      randomResult = 0.5;
    },

    teardown: function()
    {
      restorePrefs.call(this);
      restoreVirtualTime.call(this);

      stop();
      server.stop(function()
      {
        server = null;
        start();
      });

      info.application = originalApplication;
      info.addonVersion = originalAddonVersion;

      if (this._origRandom)
      {
        let DownloaderGlobal = Cu.getGlobalForObject(getModuleGlobal("downloader"));
        DownloaderGlobal.Math.random = this._origRandom;
        delete this._origRandom;
      }

      Notification.init();
    }
  });

  function registerHandler(notifications)
  {
    server.registerPathHandler("/notification.json", function(metadata, response)
    {
      response.setStatusLine("1.1", "200", "OK");
      response.setHeader("Content-Type", "application/json");

      let notification = {
        version: 55,
        notifications: notifications
      };

      let result = JSON.stringify(notification);
      response.bodyOutputStream.write(result, result.length);
    });
  }

  function fixConstructors(object)
  {
    // deepEqual() expects that the constructors used in expected objects and
    // the ones in the actual results are the same. That means that we actually
    // have to construct our objects in the context of the notification module.
    let JSON = Cu.getGlobalForObject(Notification).JSON;
    return JSON.parse(JSON.stringify(object));
  }

  test("No data", 1, function()
  {
    equal(Notification.getNextToShow(), null, "null should be returned if there is no data");
  });

  test("Single notification", 2, function()
  {
    let information = fixConstructors({
      timestamp: 1,
      severity: "information",
      message: {en: "Information"}
    });

    registerHandler([information]);
    testRunner.runScheduledTasks(1);

    deepEqual(Notification.getNextToShow(), information, "The notification is shown");
    equal(Notification.getNextToShow(), null, "Informational notifications aren't shown more than once");
  });

  test("Information and critical", 2, function()
  {
    let information = fixConstructors({
      timestamp: 1,
      severity: "information",
      message: {en: "Information"}
    });
    let critical = fixConstructors({
      timestamp: 2,
      severity: "critical",
      message: {en: "Critical"}
    });

    registerHandler([information, critical]);
    testRunner.runScheduledTasks(1);

    deepEqual(Notification.getNextToShow(), critical, "The critical notification is given priority");
    deepEqual(Notification.getNextToShow(), critical, "Critical notifications can be shown multiple times");
  });

  test("No severity", 2, function()
  {
    let information = fixConstructors({
      timestamp: 1,
      message: {en: "Information"}
    });

    registerHandler([information]);
    testRunner.runScheduledTasks(1);

    deepEqual(Notification.getNextToShow(), information, "The notification is shown");
    equal(Notification.getNextToShow(), null, "Notification is treated as severity information");
  });

  test("Different platforms", 2, function()
  {
    let information = fixConstructors({
      timestamp: 1,
      severity: "information",
      message: {en: "Information"},
      platforms: ["chrome", "firefox"]
    });
    let critical = fixConstructors({
      timestamp: 2,
      severity: "critical",
      message: {en: "Critical"},
      platforms: ["firefox"]
    });

    registerHandler([information, critical]);
    testRunner.runScheduledTasks(1);

    deepEqual(Notification.getNextToShow(), information, "Critical notification is ignored if platform doesn't match");
    deepEqual(Notification.getNextToShow(), null, "Critical notification still ignored even if no other notifications available");
  });

  test("Min version", 2, function()
  {
    let information = fixConstructors({
      timestamp: 1,
      severity: "information",
      message: {en: "Information"},
      minVersion: "1.4"
    });
    let critical = fixConstructors({
      timestamp: 2,
      severity: "critical",
      message: {en: "Critical"},
      minVersion: "1.5"
    });

    registerHandler([information, critical]);
    testRunner.runScheduledTasks(1);

    deepEqual(Notification.getNextToShow(), information, "Critical notification is ignored if minVersion doesn't match");
    deepEqual(Notification.getNextToShow(), null, "Critical notification still ignored even if no other notifications available");
  });

  test("Max version", 2, function()
  {
    let information = fixConstructors({
      timestamp: 1,
      severity: "information",
      message: {en: "Information"},
      maxVersion: "1.5"
    });
    let critical = fixConstructors({
      timestamp: 2,
      severity: "critical",
      message: {en: "Critical"},
      maxVersion: "1.4"
    });

    registerHandler([information, critical]);
    testRunner.runScheduledTasks(1);

    deepEqual(Notification.getNextToShow(), information, "Critical notification is ignored if maxVersion doesn't match");
    deepEqual(Notification.getNextToShow(), null, "Critical notification still ignored even if no other notifications available");
  });
})();
