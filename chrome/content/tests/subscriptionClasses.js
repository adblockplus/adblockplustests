(function()
{
  module("Subscription classes", {setup: prepareFilterComponents, teardown: restoreFilterComponents});

  function compareSubscription(url, expected, postInit)
  {
    expected.push("[Subscription]")
    let subscription = Subscription.fromURL(url);
    if (postInit)
      postInit(subscription)
    let result = [];
    subscription.serialize(result);
    equal(result.sort().join("\n"), expected.sort().join("\n"), url);

    let map = {__proto__: null};
    for (let line of result.slice(1))
    {
      if (/(.*?)=(.*)/.test(line))
        map[RegExp.$1] = RegExp.$2;
    }
    let subscription2 = Subscription.fromObject(map);
    equal(subscription.toString(), subscription2.toString(), url + " deserialization");
  }

  test("Subscription class definitions", function()
  {
    equal(typeof Subscription, "function", "typeof Subscription");
    equal(typeof SpecialSubscription, "function", "typeof SpecialSubscription");
    equal(typeof RegularSubscription, "function", "typeof RegularSubscription");
    equal(typeof ExternalSubscription, "function", "typeof ExternalSubscription");
    equal(typeof DownloadableSubscription, "function", "typeof DownloadableSubscription");
  });

  test("Subscriptions with state", function()
  {
    compareSubscription("~fl~", ["url=~fl~"]);
    compareSubscription("http://test/default", ["url=http://test/default", "title=http://test/default"]);
    compareSubscription("http://test/default_titled", ["url=http://test/default_titled", "title=test"], function(subscription)
    {
      subscription.title = "test";
    });
    compareSubscription("http://test/non_default", ["url=http://test/non_default", "title=test",
                                                    "disabled=true", "lastSuccess=8", "lastDownload=12", "lastCheck=16", "softExpiration=18", "expires=20", "downloadStatus=foo",
                                                    "errors=3", "version=24", "requiredVersion=0.6"], function(subscription)
    {
      subscription.title = "test";
      subscription.disabled = true;
      subscription.lastSuccess = 8;
      subscription.lastDownload = 12;
      subscription.lastCheck = 16;
      subscription.softExpiration = 18;
      subscription.expires = 20;
      subscription.downloadStatus = "foo";
      subscription.errors = 3;
      subscription.version = 24
      subscription.requiredVersion = "0.6";
    });
    compareSubscription("~wl~", ["url=~wl~", "disabled=true", "title=Test group"], function(subscription)
    {
      subscription.title = "Test group";
      subscription.disabled = true;
    });
  });
})();
