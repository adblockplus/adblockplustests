(function()
{
  module("Preferences",
  {
    setup: function()
    {
      preparePrefs.call(this);
    },

    teardown: function()
    {
      restorePrefs.call(this);
    }
  });

  function prefExists(name)
  {
    if ("chrome" in window)
      return name in localStorage;
    else
      return Services.prefs.prefHasUserValue("extensions.adblockplus." + name);
  }

  function checkPref(name, expectedValue, description)
  {
    let value = null;
    if ("chrome" in window)
    {
      try
      {
        value = JSON.parse(localStorage[name]);
      }
      catch (e)
      {
        Cu.reportError(e);
      }
    }
    else
    {
      let pref = "extensions.adblockplus." + name;
      switch (typeof expectedValue)
      {
        case "number":
          value = Services.prefs.getIntPref(pref);
          break;
        case "boolean":
          value = Services.prefs.getBoolPref(pref);
          break;
        case "string":
          value = Services.prefs.getComplexValue(pref, Ci.nsISupportsString).data;
          break;
        case "object":
          value = JSON.parse(Services.prefs.getComplexValue(pref, Ci.nsISupportsString).data);
          break;
      }
    }
    deepEqual(value, expectedValue, description);
  }

  test("Numerical pref", function()
  {
    Prefs.patternsbackups = 5;
    equal(Prefs.patternsbackups, 5, "Prefs object returns the correct value after setting pref to default value");
    equal(prefExists("patternsbackups"), false, "User-defined pref has been removed");
    Prefs.patternsbackups = 12;
    equal(Prefs.patternsbackups, 12, "Prefs object returns the correct value after setting pref to non-default value");
    equal(prefExists("patternsbackups"), true, "User-defined pref has been created");
    checkPref("patternsbackups", 12, "Value has been written");
  });

  test("Boolean pref", function()
  {
    Prefs.enabled = true;
    equal(Prefs.enabled, true, "Prefs object returns the correct value after setting pref to default value");
    equal(prefExists("enabled"), false, "User-defined pref has been removed");
    Prefs.enabled = false;
    equal(Prefs.enabled, false, "Prefs object returns the correct value after setting pref to non-default value");
    equal(prefExists("enabled"), true, "User-defined pref has been created");
    checkPref("enabled", false, "Value has been written");
  });

  test("String pref", function()
  {
    let defaultValue = "https://notification.adblockplus.org/notification.json";
    Prefs.notificationurl = defaultValue;
    equal(Prefs.notificationurl, defaultValue, "Prefs object returns the correct value after setting pref to default value");
    equal(prefExists("notificationurl"), false, "User-defined pref has been removed");

    let newValue = "https://notification.adblockplus.org/foo\u1234bar.json";
    Prefs.notificationurl = newValue;
    equal(Prefs.notificationurl, newValue, "Prefs object returns the correct value after setting pref to non-default value");
    equal(prefExists("notificationurl"), true, "User-defined pref has been created");
    checkPref("notificationurl", newValue, "Value has been written");
  });

  test("Object pref (complete replacement)", function()
  {
    Prefs.notificationdata = {};
    deepEqual(Prefs.notificationdata, {}, "Prefs object returns the correct value after setting pref to default value");
    equal(prefExists("notificationdata"), false, "User-defined pref has been removed");

    let newValue = {foo:1, bar: "adsf\u1234"};
    Prefs.notificationdata = newValue;
    equal(Prefs.notificationdata, newValue, "Prefs object returns the correct value after setting pref to non-default value");
    equal(prefExists("notificationdata"), true, "User-defined pref has been created");
    checkPref("notificationdata", newValue, "Value has been written");
  });

  test("Property-wise modification", function()
  {
    Prefs.notificationdata = {};

    Prefs.notificationdata.foo = 1;
    Prefs.notificationdata.bar = 2;
    Prefs.notificationdata = JSON.parse(JSON.stringify(Prefs.notificationdata));
    deepEqual(Prefs.notificationdata, {foo:1, bar: 2}, "Prefs object returns the correct value after setting pref to non-default value");
    equal(prefExists("notificationdata"), true, "User-defined pref has been created");
    checkPref("notificationdata", {foo:1, bar: 2}, "Value has been written");

    delete Prefs.notificationdata.foo;
    delete Prefs.notificationdata.bar;
    Prefs.notificationdata = JSON.parse(JSON.stringify(Prefs.notificationdata));
    deepEqual(Prefs.notificationdata, {}, "Prefs object returns the correct value after setting pref to default value");
    equal(prefExists("notificationdata"), false, "User-defined pref has been removed");
  });
})();
