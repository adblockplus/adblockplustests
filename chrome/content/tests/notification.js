// TODO: Use let and other FF features where possible

(function()
{
  let originalApplication;
  let originalAddonVersion;
  let info = require("info");
  let {Notification} = require("notification");

  module("Notification",
  {
    setup: function()
    {
      originalApplication = info.application;
      info.application = "chrome";
      originalAddonVersion = info.addonVersion;
      info.addonVersion = "1.4.1";
      Prefs.shownNotifications = null;
    },
    teardown: function()
    {
      info.application = originalApplication;
      info.addonVersion = originalAddonVersion;
    }
  });

  test("Single notification", 1, function()
  {
    let information = {
      timestamp: 1,
      severity: "information",
      message: {en: "Information"}
    };
    let notification = Notification.getNextToShow([information]);
    equal(notification, information);
  });

  test("Information and critical", 1, function()
  {
    let information = {
      timestamp: 1,
      severity: "information",
      message: {en: "Information"}
    };
    let critical = {
      timestamp: 2,
      severity: "critical",
      message: {en: "Critical"}
    };
    let notification = Notification.getNextToShow([information, critical]);
    equal(notification, critical);
  });

  test("Different platforms", 1, function()
  {
    let information = {
      timestamp: 1,
      severity: "information",
      message: {en: "Information"},
      platforms: ["chrome", "firefox"]
    };
    let critical = {
      timestamp: 2,
      severity: "critical",
      message: {en: "Critical"},
      platforms: ["firefox"]
    };
    let notification = Notification.getNextToShow([information, critical]);
    equal(notification, information);
  });

  test("Min version", 1, function()
  {
    let information = {
      timestamp: 1,
      severity: "information",
      message: {en: "Information"},
      minVersion: "1.4"
    };
    let critical = {
      timestamp: 2,
      severity: "critical",
      message: {en: "Critical"},
      minVersion: "1.5"
    };
    let notification = Notification.getNextToShow([information, critical]);
    equal(notification, information);
  });

  test("Max version", 1, function()
  {
    let information = {
      timestamp: 1,
      severity: "information",
      message: {en: "Information"},
      maxVersion: "1.5"
    };
    let critical = {
      timestamp: 2,
      severity: "critical",
      message: {en: "Critical"},
      maxVersion: "1.4"
    };
    let notification = Notification.getNextToShow([information, critical]);
    equal(notification, information);
  });

  test("Information notifications appear just once", 2, function()
  {
    let information = {
      timestamp: 1,
      severity: "information",
      message: {en: "Information"}
    };
    let notification = Notification.getNextToShow([information]);
    equal(notification, information);
    notification = Notification.getNextToShow([information]);
    ok(!notification, "Notification shouldn't be shown twice");
  });

  test("Critical notifications appear every time", 2, function()
  {
    let critical = {
      timestamp: 1,
      severity: "critical",
      message: {en: "Critical"}
    };
    let notification = Notification.getNextToShow([critical]);
    equal(notification, critical);
    notification = Notification.getNextToShow([critical]);
    equal(notification, critical);
  });
})();
