(function()
{
  let testRunner = null;
  let server = null;
  let randomResult = 0.5;

  let originalInfo;
  let info = require("info");

  module("Notification handling",
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

      originalInfo = {};
      for (let key in info)
        originalInfo[key] = info[key];

      info.addonName = "adblockpluschrome";
      info.addonVersion = "1.4.1";
      info.application = "chrome";
      info.applicationVersion = "27.0";
      info.platform = "chromium";
      info.platformVersion = "12.0";

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

      for (let key in originalInfo)
        info[key] = originalInfo[key];

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

  test("No data", function()
  {
    equal(Notification.getNextToShow(), null, "null should be returned if there is no data");
  });

  test("Single notification", function()
  {
    let information = fixConstructors({
      id: 1,
      severity: "information",
      message: {"en-US": "Information"}
    });

    registerHandler([information]);
    testRunner.runScheduledTasks(1);

    deepEqual(Notification.getNextToShow(), information, "The notification is shown");
    equal(Notification.getNextToShow(), null, "Informational notifications aren't shown more than once");
  });

  test("Information and critical", function()
  {
    let information = fixConstructors({
      id: 1,
      severity: "information",
      message: {"en-US": "Information"}
    });
    let critical = fixConstructors({
      id: 2,
      severity: "critical",
      message: {"en-US": "Critical"}
    });

    registerHandler([information, critical]);
    testRunner.runScheduledTasks(1);

    deepEqual(Notification.getNextToShow(), critical, "The critical notification is given priority");
    deepEqual(Notification.getNextToShow(), critical, "Critical notifications can be shown multiple times");
  });

  test("No severity", function()
  {
    let information = fixConstructors({
      id: 1,
      message: {"en-US": "Information"}
    });

    registerHandler([information]);
    testRunner.runScheduledTasks(1);

    deepEqual(Notification.getNextToShow(), information, "The notification is shown");
    equal(Notification.getNextToShow(), null, "Notification is treated as severity information");
  });

  test("Target selection", function()
  {
    let targets = [
      ["extension", "adblockpluschrome", true],
      ["extension", "adblockplus", false],
      ["extension", "adblockpluschrome2", false],
      ["extensionMinVersion", "1.4", true],
      ["extensionMinVersion", "1.4.1", true],
      ["extensionMinVersion", "1.5", false],
      ["extensionMaxVersion", "1.5", true],
      ["extensionMaxVersion", "1.4.1", true],
      ["extensionMaxVersion", "1.4.*", true],
      ["extensionMaxVersion", "1.4", false],
      ["application", "chrome", true],
      ["application", "firefox", false],
      ["applicationMinVersion", "27.0", true],
      ["applicationMinVersion", "27", true],
      ["applicationMinVersion", "26", true],
      ["applicationMinVersion", "28", false],
      ["applicationMinVersion", "27.1", false],
      ["applicationMaxVersion", "27.0", true],
      ["applicationMaxVersion", "27", true],
      ["applicationMaxVersion", "28", true],
      ["applicationMaxVersion", "26", false],
      ["platform", "chromium", true],
      ["platform", "gecko", false],
      ["platformMinVersion", "12.0", true],
      ["platformMinVersion", "12", true],
      ["platformMinVersion", "11", true],
      ["platformMinVersion", "13", false],
      ["platformMinVersion", "12.1", false],
      ["platformMaxVersion", "12.0", true],
      ["platformMaxVersion", "12", true],
      ["platformMaxVersion", "13", true],
      ["platformMaxVersion", "11", false],
    ];

    for each (let [propName, value, result] in targets)
    {
      let targetInfo = {};
      targetInfo[propName] = value;

      let information = fixConstructors({
        id: 1,
        severity: "information",
        message: {"en-US": "Information"},
        targets: [targetInfo]
      });

      Prefs.notificationdata = {};
      registerHandler([information]);
      testRunner.runScheduledTasks(1);

      let expected = (result ? information : null);
      deepEqual(Notification.getNextToShow(), expected, "Selected notification for " + JSON.stringify(information.targets));
      deepEqual(Notification.getNextToShow(), null, "No notification on second call");
    }

    function pairs(array)
    {
      for each (let element1 in array)
        for each (let element2 in array)
          yield [element1, element2];
    }
    for (let [[propName1, value1, result1], [propName2, value2, result2]] in pairs(targets))
    {
      let targetInfo1 = {};
      targetInfo1[propName1] = value1;
      let targetInfo2 = {};
      targetInfo2[propName2] = value2;

      let information = fixConstructors({
        id: 1,
        severity: "information",
        message: {"en-US": "Information"},
        targets: [targetInfo1, targetInfo2]
      });

      Prefs.notificationdata = {};
      registerHandler([information]);
      testRunner.runScheduledTasks(1);

      let expected = (result1 || result2 ? information : null)
      deepEqual(Notification.getNextToShow(), expected, "Selected notification for " + JSON.stringify(information.targets));
      deepEqual(Notification.getNextToShow(), null, "No notification on second call");

      information = fixConstructors({
        id: 1,
        severity: "information",
        message: {"en-US": "Information"},
        targets: [targetInfo1]
      });
      let critical = fixConstructors({
        id: 2,
        severity: "critical",
        message: {"en-US": "Critical"},
        targets: [targetInfo2]
      });

      Prefs.notificationdata = {};
      registerHandler([information, critical]);
      testRunner.runScheduledTasks(1);

      expected = (result2 ? critical : (result1 ? information : null));
      deepEqual(Notification.getNextToShow(), expected, "Selected notification for information with " + JSON.stringify(information.targets) + " and critical with " + JSON.stringify(critical.targets));
    }
  });

  module("Notification localization");

  test("Language only", function()
  {
    let notification = {message: {fr: "fr"}};
    let texts = Notification.getLocalizedTexts(notification, "fr");
    equal(texts.message, "fr");
    texts = Notification.getLocalizedTexts(notification, "fr-CA");
    equal(texts.message, "fr");
  });

  test("Language and country", function()
  {
    let notification = {message: {fr: "fr", "fr-CA": "fr-CA"}};
    let texts = Notification.getLocalizedTexts(notification, "fr-CA");
    equal(texts.message, "fr-CA");
    texts = Notification.getLocalizedTexts(notification, "fr");
    equal(texts.message, "fr");
  });

  test("Missing translation", function()
  {
    let notification = {message: {"en-US": "en-US"}};
    let texts = Notification.getLocalizedTexts(notification, "fr");
    equal(texts.message, "en-US");
  });
})();
