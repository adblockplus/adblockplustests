(function()
{
  let testRunner = null;
  let randomResult = 0.5;

  let originalInfo;
  let info = require("info");

  function showNotifications(url)
  {
    let shownNotifications = [];
    function showListener(notification)
    {
      shownNotifications.push(notification);
      Notification.markAsShown(notification.id);
    }
    Notification.addShowListener(showListener);
    Notification.showNext(url);
    Notification.removeShowListener(showListener);
    return shownNotifications;
  }

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
      setupVirtualXMLHttp.call(this, "notification", "downloader");

      originalInfo = {};
      for (let key in info)
        originalInfo[key] = info[key];

      info.addonName = "adblockpluschrome";
      info.addonVersion = "1.4.1";
      info.application = "chrome";
      info.applicationVersion = "27.0";
      info.platform = "chromium";
      info.platformVersion = "12.0";

      Prefs.notificationurl = "http://example.com/notification.json";
      Prefs.notificationdata = {};
      Prefs.notifications_ignoredcategories = [];

      // Replace Math.random() function
      let DownloaderGlobal = Cu.getGlobalForObject(getModuleGlobal("downloader"));
      this._origRandom = DownloaderGlobal.Math.random;
      DownloaderGlobal.Math.random = () => randomResult;
      randomResult = 0.5;

      let NotificationGlobal = getModuleGlobal("notification");
      this._origShowListeners = NotificationGlobal.showListeners;
      NotificationGlobal.showListeners = [];
    },

    teardown: function()
    {
      restorePrefs.call(this);
      restoreVirtualTime.call(this);
      restoreVirtualXMLHttp.call(this);

      for (let key in originalInfo)
        info[key] = originalInfo[key];

      if (this._origRandom)
      {
        let DownloaderGlobal = Cu.getGlobalForObject(getModuleGlobal("downloader"));
        DownloaderGlobal.Math.random = this._origRandom;
        delete this._origRandom;
      }

      if (this._origShowListeners)
      {
        let NotificationGlobal = getModuleGlobal("notification");
        NotificationGlobal.showListeners = this._origShowListeners;
        delete this._origShowListeners;
      }

      Notification.init();
    }
  });

  function registerHandler(notifications, checkCallback)
  {
    testRunner.registerHandler("/notification.json", function(metadata)
    {
      if (checkCallback)
        checkCallback(metadata);

      let notification = {
        version: 55,
        notifications: notifications
      };

      return [Cr.NS_OK, 200, JSON.stringify(notification)];
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
    deepEqual(showNotifications(), [], "No notifications should be returned if there is no data");
  });

  test("Single notification", function()
  {
    let information = fixConstructors({
      id: 1,
      type: "information",
      message: {"en-US": "Information"}
    });

    registerHandler([information]);
    testRunner.runScheduledTasks(1);

    deepEqual(showNotifications(), [information], "The notification is shown");
    deepEqual(showNotifications(), [], "Informational notifications aren't shown more than once");
  });

  test("Information and critical", function()
  {
    let information = fixConstructors({
      id: 1,
      type: "information",
      message: {"en-US": "Information"}
    });
    let critical = fixConstructors({
      id: 2,
      type: "critical",
      message: {"en-US": "Critical"}
    });

    registerHandler([information, critical]);
    testRunner.runScheduledTasks(1);

    deepEqual(showNotifications(), [critical], "The critical notification is given priority");
    deepEqual(showNotifications(), [critical], "Critical notifications can be shown multiple times");
  });

  test("No type", function()
  {
    let information = fixConstructors({
      id: 1,
      message: {"en-US": "Information"}
    });

    registerHandler([information]);
    testRunner.runScheduledTasks(1);

    deepEqual(showNotifications(), [information], "The notification is shown");
    deepEqual(showNotifications(), [], "Notification is treated as type information");
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

    for (let [propName, value, result] of targets)
    {
      let targetInfo = {};
      targetInfo[propName] = value;

      let information = fixConstructors({
        id: 1,
        type: "information",
        message: {"en-US": "Information"},
        targets: [targetInfo]
      });

      Prefs.notificationdata = {};
      registerHandler([information]);
      testRunner.runScheduledTasks(1);

      let expected = (result ? [information] : []);
      deepEqual(showNotifications(), expected, "Selected notification for " + JSON.stringify(information.targets));
      deepEqual(showNotifications(), [], "No notification on second call");
    }
  });

  test("Multiple targets", function()
  {
    let targets = [
      ["extension", "adblockpluschrome", true],
      ["extension", "adblockplus", false],
      ["extensionMinVersion", "1.4", true],
      ["extensionMinVersion", "1.5", false],
      ["application", "chrome", true],
      ["application", "firefox", false],
      ["applicationMinVersion", "27", true],
      ["applicationMinVersion", "28", false],
      ["platform", "chromium", true],
      ["platform", "gecko", false],
      ["platformMinVersion", "12", true],
      ["platformMinVersion", "13", false],
    ];

    function pairs(array)
    {
      for (let element1 of array)
        for (let element2 of array)
          if (element1 != element2)
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
        type: "information",
        message: {"en-US": "Information"},
        targets: [targetInfo1, targetInfo2]
      });

      Prefs.notificationdata = {};
      registerHandler([information]);
      testRunner.runScheduledTasks(1);

      let expected = (result1 || result2 ? [information] : [])
      deepEqual(showNotifications(), expected, "Selected notification for " + JSON.stringify(information.targets));
    }
  });

  test("Parameters sent", function()
  {
    Prefs.notificationdata = {
      data: {
        version: "3"
      },
    };

    let parameters = null;
    registerHandler([], function(metadata)
    {
      parameters = decodeURI(metadata.queryString);
    });
    testRunner.runScheduledTasks(1);

    equal(parameters,
          "addonName=adblockpluschrome&addonVersion=1.4.1&application=chrome&applicationVersion=27.0&platform=chromium&platformVersion=12.0&lastVersion=3&downloadCount=0",
          "The correct parameters are sent to the server");
  });

  test("Expiration interval", function()
  {
    let initialDelay = 1 / 60;
    let tests = [
      {
        randomResult: 0.5,
        requests: [initialDelay, initialDelay + 24, initialDelay + 48]
      },
      {
        randomResult: 0,        // Changes interval by factor 0.8 (19.2 hours)
        requests: [initialDelay, initialDelay + 20, initialDelay + 40]
      },
      {
        randomResult: 1,        // Changes interval by factor 1.2 (28.8 hours)
        requests: [initialDelay, initialDelay + 29, initialDelay + 58]
      },
      {
        randomResult: 0.25,     // Changes interval by factor 0.9 (21.6 hours)
        requests: [initialDelay, initialDelay + 22, initialDelay + 44]
      },
      {
        randomResult: 0.5,
        skipAfter: initialDelay + 5,
        skip: 10,               // Short break should not increase soft expiration
        requests: [initialDelay, initialDelay + 24]
      },
      {
        randomResult: 0.5,
        skipAfter: initialDelay + 5,
        skip: 30,               // Long break should increase soft expiration, hitting hard expiration
        requests: [initialDelay, initialDelay + 48]
      }
    ];

    let requests = [];
    registerHandler([], (metadata) => requests.push(testRunner.getTimeOffset()));
    for (let test of tests)
    {
      Prefs.notificationdata = {};
      requests = [];
      randomResult = test.randomResult;

      let maxHours = Math.round(Math.max.apply(null, test.requests)) + 1;
      testRunner.runScheduledTasks(maxHours, test.skipAfter, test.skip);

      let skipAddendum = (typeof test.skip != "number" ? "" : " skipping " + test.skip + " hours after " + test.skipAfter + " hours");
      deepEqual(requests, test.requests, "Requests with Math.random() returning " + randomResult + skipAddendum);
    }
  });

  test("Uses severity instead of type", 3, function()
  {
    let severityNotification = {
      id: 1,
      severity: "information",
      message: {"en-US": "Information"}
    };

    function listener(name)
    {
      if (name !== "notificationdata")
        return;

      Prefs.removeListener(listener);
      let notification = Prefs.notificationdata.data.notifications[0];
      ok(!("severity" in notification), "Severity property was removed");
      ok("type" in notification, "Type property was added");
      equal(notification.type, severityNotification.severity, "Type property has correct value");
    }
    Prefs.addListener(listener);

    let responseText = JSON.stringify({
      notifications: [severityNotification]
    });
    Notification._onDownloadSuccess({}, responseText, function() {}, function() {});
  });

  test("URL-specific notification", function()
  {
    let withURLFilterFoo = fixConstructors({
      id: 1,
      urlFilters: ["foo.com$document"]
    });
    let withoutURLFilter = fixConstructors({
      id: 2
    });
    let withURLFilterBar = fixConstructors({
      id: 3,
      urlFilters: ["bar.com$document"]
    });
    let subdomainURLFilter = fixConstructors({
      id: 4,
      urlFilters: ["||example.com$document"]
    });

    registerHandler([
      withURLFilterFoo,
      withoutURLFilter,
      withURLFilterBar,
      subdomainURLFilter
    ]);
    testRunner.runScheduledTasks(1);

    deepEqual(showNotifications(), [withoutURLFilter], "URL-specific notifications are skipped");
    deepEqual(showNotifications("http://foo.com"), [withURLFilterFoo], "URL-specific notification is retrieved");
    deepEqual(showNotifications("http://foo.com"), [], "URL-specific notification is not retrieved");
    deepEqual(showNotifications("http://www.example.com"), [subdomainURLFilter], "URL-specific notification matches subdomain");
  });

  test("Global opt-out", function()
  {
    Notification.toggleIgnoreCategory("*", true);
    ok(Prefs.notifications_ignoredcategories.indexOf("*") != -1, "Force enable global opt-out");
    Notification.toggleIgnoreCategory("*", true);
    ok(Prefs.notifications_ignoredcategories.indexOf("*") != -1, "Force enable global opt-out (again)");
    Notification.toggleIgnoreCategory("*", false);
    ok(Prefs.notifications_ignoredcategories.indexOf("*") == -1, "Force disable global opt-out");
    Notification.toggleIgnoreCategory("*", false);
    ok(Prefs.notifications_ignoredcategories.indexOf("*") == -1, "Force disable global opt-out (again)");
    Notification.toggleIgnoreCategory("*");
    ok(Prefs.notifications_ignoredcategories.indexOf("*") != -1, "Toggle enable global opt-out");
    Notification.toggleIgnoreCategory("*");
    ok(Prefs.notifications_ignoredcategories.indexOf("*") == -1, "Toggle disable global opt-out");

    Prefs.notifications_showui = false;
    Notification.toggleIgnoreCategory("*", false);
    ok(!Prefs.notifications_showui, "Opt-out UI will not be shown if global opt-out hasn't been enabled yet");
    Notification.toggleIgnoreCategory("*", true);
    ok(Prefs.notifications_showui, "Opt-out UI will be shown after enabling global opt-out");
    Notification.toggleIgnoreCategory("*", false);
    ok(Prefs.notifications_showui, "Opt-out UI will be shown after enabling global opt-out even if it got disabled again");

    let information = fixConstructors({
      id: 1,
      type: "information"
    });
    let critical = fixConstructors({
      id: 2,
      type: "critical"
    });

    Notification.toggleIgnoreCategory("*", true);
    registerHandler([information]);
    testRunner.runScheduledTasks(1);

    deepEqual(showNotifications(), [], "Information notifications are ignored after enabling global opt-out");
    Notification.toggleIgnoreCategory("*", false);
    deepEqual(showNotifications(), [information], "Information notifications are shown after disabling global opt-out");

    Notification.toggleIgnoreCategory("*", true);
    Prefs.notificationdata = {};
    registerHandler([critical]);
    testRunner.runScheduledTasks(1);

    deepEqual(showNotifications(), [critical], "Critical notifications are not ignored");
  });

  module("Notification localization");

  test("Message without localization", function()
  {
    let notification = {message: "non-localized"};
    let texts = Notification.getLocalizedTexts(notification, "en-US");
    equal(texts.message, "non-localized");
  });

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
