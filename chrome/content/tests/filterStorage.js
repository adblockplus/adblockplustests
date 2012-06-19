(function()
{
  module("Filter storage", {
    setup: function()
    {
      prepareFilterComponents.call(this);
      preparePrefs.call(this);
    },
    teardown: function()
    {
      restoreFilterComponents.call(this);
      restorePrefs.call(this);
    }
  });

  function compareSubscriptionList(test, list)
  {
    let result = FilterStorage.subscriptions.map(function(subscription) {return subscription.url});
    let expected = list.map(function(subscription) {return subscription.url});
    deepEqual(result, expected, test);
  }

  function compareFiltersList(test, list)
  {
    let result = FilterStorage.subscriptions.map(function(subscription) {return subscription.filters.map(function(filter) {return filter.text})});
    deepEqual(result, list, test);
  }

  function compareFilterSubscriptions(test, filter, list)
  {
    let result = filter.subscriptions.map(function(subscription) {return subscription.url});
    let expected = list.map(function(subscription) {return subscription.url});
    deepEqual(result, expected, test);
  }

  test("Adding and removing subscriptions", function()
  {
    let changes = [];
    function listener(action, subscription)
    {
      changes.push(action + " " + subscription.url);
    }
    FilterNotifier.addListener(listener);

    let subscription1 = Subscription.fromURL("http://test1/");
    let subscription2 = Subscription.fromURL("http://test2/");
    let subscription3 = Subscription.fromURL("http://test3/");

    compareSubscriptionList("No subscriptions", []);
    deepEqual(changes, [], "Received changes");

    changes = [];
    FilterStorage.addSubscription(subscription1);
    compareSubscriptionList("add(test1)", [subscription1]);
    deepEqual(changes, ["subscription.added http://test1/"], "Received changes");

    changes = [];
    FilterStorage.addSubscription(subscription1);
    compareSubscriptionList("add(test1) again", [subscription1]);
    deepEqual(changes, [], "Received changes");

    changes = [];
    FilterStorage.removeSubscription(subscription2);
    compareSubscriptionList("remove(test2)", [subscription1]);
    deepEqual(changes, [], "Received changes");

    changes = [];
    FilterStorage.addSubscription(subscription2, true);
    compareSubscriptionList("add(test2) silent", [subscription1, subscription2]);
    deepEqual(changes, [], "Received changes");

    changes = [];
    FilterStorage.addSubscription(subscription3);
    compareSubscriptionList("add(test3)", [subscription1, subscription2, subscription3]);
    deepEqual(changes, ["subscription.added http://test3/"], "Received changes");

    changes = [];
    FilterStorage.removeSubscription(subscription1, true);
    compareSubscriptionList("remove(test1) silent", [subscription2, subscription3]);
    deepEqual(changes, [], "Received changes");

    changes = [];
    FilterStorage.removeSubscription(subscription1);
    compareSubscriptionList("remove(test1) again", [subscription2, subscription3]);
    deepEqual(changes, [], "Received changes");

    changes = [];
    FilterStorage.addSubscription(subscription1);
    compareSubscriptionList("add(test1)", [subscription2, subscription3, subscription1]);
    deepEqual(changes, ["subscription.added http://test1/"], "Received changes");

    changes = [];
    FilterStorage.moveSubscription(subscription1, subscription2);
    compareSubscriptionList("move(test1)", [subscription1, subscription2, subscription3]);
    deepEqual(changes, ["subscription.moved http://test1/"], "Received changes");

    changes = [];
    FilterStorage.moveSubscription(subscription1, subscription2);
    compareSubscriptionList("move(test1) again", [subscription1, subscription2, subscription3]);
    deepEqual(changes, [], "Received changes");

    changes = [];
    FilterStorage.removeSubscription(subscription3);
    compareSubscriptionList("remove(test3)", [subscription1, subscription2]);
    deepEqual(changes, ["subscription.removed http://test3/"], "Received changes");

    changes = [];
    FilterStorage.removeSubscription(subscription3);
    compareSubscriptionList("remove(test3) again", [subscription1, subscription2]);
    deepEqual(changes, [], "Received changes");
  });

  test("Adding and removing filters", function()
  {
    let subscription1 = Subscription.fromURL("blocking");
    subscription1.defaults = ["blocking"];

    let subscription2 = Subscription.fromURL("exceptions");
    subscription2.defaults = ["whitelist", "elemhide"];

    let subscription3 = Subscription.fromURL("other");

    FilterStorage.addSubscription(subscription1);
    FilterStorage.addSubscription(subscription2);
    FilterStorage.addSubscription(subscription3);

    let changes = [];
    function listener(action, filter)
    {
      changes.push(action + " " + filter.text);
    }
    FilterNotifier.addListener(listener);

    compareFiltersList("No filters", [[], [], []]);
    deepEqual(changes, [], "Received changes");

    changes = [];
    FilterStorage.addFilter(Filter.fromText("foo"));
    compareFiltersList("add(foo)", [["foo"], [], []]);
    deepEqual(changes, ["filter.added foo"], "Received changes");

    changes = [];
    FilterStorage.addFilter(Filter.fromText("bar"));
    compareFiltersList("add(bar)", [["foo", "bar"], [], []]);
    deepEqual(changes, ["filter.added bar"], "Received changes");

    changes = [];
    FilterStorage.removeFilter(Filter.fromText("foobar"));
    compareFiltersList("remove(foobar)", [["foo", "bar"], [], []]);
    deepEqual(changes, [], "Received changes");

    changes = [];
    FilterStorage.addFilter(Filter.fromText("@@ddd"));
    compareFiltersList("add(@@ddd)", [["foo", "bar"], ["@@ddd"], []]);
    deepEqual(changes, ["filter.added @@ddd"], "Received changes");

    changes = [];
    FilterStorage.addFilter(Filter.fromText("!foobar"));
    compareFiltersList("add(!foobar)", [["foo", "bar"], ["@@ddd"], ["!foobar"]]);
    deepEqual(changes, ["filter.added !foobar"], "Received changes");

    changes = [];
    FilterStorage.removeFilter(Filter.fromText("bar"));
    compareFiltersList("remove(bar)", [["foo"], ["@@ddd"], ["!foobar"]]);
    deepEqual(changes, ["filter.removed bar"], "Received changes");

    changes = [];
    FilterStorage.removeFilter(Filter.fromText("@@ddd"));
    compareFiltersList("remove(@@ddd)", [["foo"], [], ["!foobar"]]);
    deepEqual(changes, ["filter.removed @@ddd"], "Received changes");

    changes = [];
    FilterStorage.addFilter(Filter.fromText("foo#bar"));
    compareFiltersList("add(foo#bar)", [["foo"], ["foo#bar"], ["!foobar"]]);
    deepEqual(changes, ["filter.added foo#bar"], "Received changes");

    changes = [];
    FilterStorage.addFilter(Filter.fromText("!foobar"), subscription1);
    compareFiltersList("add(!foobar) to sub1", [["foo", "!foobar"], ["foo#bar"], ["!foobar"]]);
    deepEqual(changes, ["filter.added !foobar"], "Received changes");

    changes = [];
    FilterStorage.moveFilter(Filter.fromText("!foobar"), subscription1, 1, 0);
    compareFiltersList("move(!foobar)", [["!foobar", "foo"], ["foo#bar"], ["!foobar"]]);
    deepEqual(changes, ["filter.moved !foobar"], "Received changes");

    changes = [];
    FilterStorage.moveFilter(Filter.fromText("!foobar"), subscription1, 0, 0);
    compareFiltersList("move(!foobar) again", [["!foobar", "foo"], ["foo#bar"], ["!foobar"]]);
    deepEqual(changes, [], "Received changes");

    changes = [];
    FilterStorage.moveFilter(Filter.fromText("!foobar"), subscription1, 1, 0);
    compareFiltersList("invalid move", [["!foobar", "foo"], ["foo#bar"], ["!foobar"]]);
    deepEqual(changes, [], "Received changes");

    changes = [];
    FilterStorage.addFilter(Filter.fromText("!foobar"), subscription2);
    compareFiltersList("add(!foobar) to sub2", [["!foobar", "foo"], ["foo#bar", "!foobar"], ["!foobar"]]);
    deepEqual(changes, ["filter.added !foobar"], "Received changes");

    changes = [];
    FilterStorage.addFilter(Filter.fromText("!foobar"), subscription2, 0, true);
    compareFiltersList("add(!foobar) to sub2 position 0 silent", [["!foobar", "foo"], ["!foobar", "foo#bar", "!foobar"], ["!foobar"]]);
    deepEqual(changes, [], "Received changes");

    subscription2.disabled = true;
    changes = [];
    FilterStorage.addFilter(Filter.fromText("@@asdf"));
    compareFiltersList("add(@@asdf)", [["!foobar", "foo"], ["!foobar", "foo#bar", "!foobar"], ["!foobar", "@@asdf"]]);
    deepEqual(changes, ["filter.added @@asdf"], "Received changes");

    changes = [];
    FilterStorage.removeFilter(Filter.fromText("!foobar"), subscription2, 0);
    compareFiltersList("remove(!foobar) from sub2 position 0", [["!foobar", "foo"], ["foo#bar", "!foobar"], ["!foobar", "@@asdf"]]);
    deepEqual(changes, ["filter.removed !foobar"], "Received changes");

    changes = [];
    FilterStorage.removeFilter(Filter.fromText("!foobar"));
    compareFiltersList("remove(!foobar)", [["foo"], ["foo#bar"], ["@@asdf"]]);
    deepEqual(changes, ["filter.removed !foobar", "filter.removed !foobar", "filter.removed !foobar"], "Received changes");
  });

  test("Hit counts", function()
  {
    let changes = [];
    function listener(action, filter)
    {
      changes.push(action + " " + filter.text);
    }
    FilterNotifier.addListener(listener);

    let filter1 = Filter.fromText("filter1");
    let filter2 = Filter.fromText("filter2");

    FilterStorage.addFilter(filter1);

    equal(filter1.hitCount, 0, "filter1 initial hit count");
    equal(filter2.hitCount, 0, "filter2 initial hit count");
    equal(filter1.lastHit, 0, "filter1 initial last hit");
    equal(filter2.lastHit, 0, "filter2 initial last hit");

    let changes = [];
    FilterStorage.increaseHitCount(filter1);
    equal(filter1.hitCount, 1, "Hit count after increase (filter in least)");
    ok(filter1.lastHit > 0, "Last hit changed after increase");
    deepEqual(changes, ["filter.hitCount filter1", "filter.lastHit filter1"], "Received changes");

    let changes = [];
    FilterStorage.increaseHitCount(filter2);
    equal(filter2.hitCount, 1, "Hit count after increase (filter not in list)");
    ok(filter2.lastHit > 0, "Last hit changed after increase");
    deepEqual(changes, ["filter.hitCount filter2", "filter.lastHit filter2"], "Received changes");

    let changes = [];
    FilterStorage.resetHitCounts([filter1]);
    equal(filter1.hitCount, 0, "Hit count after reset");
    equal(filter1.lastHit, 0, "Last hit after reset");
    deepEqual(changes, ["filter.hitCount filter1", "filter.lastHit filter1"], "Received changes");

    let changes = [];
    FilterStorage.resetHitCounts(null);
    equal(filter2.hitCount, 0, "Hit count after complete reset");
    equal(filter2.lastHit, 0, "Last hit after complete reset");
    deepEqual(changes, ["filter.hitCount filter2", "filter.lastHit filter2"], "Received changes");
  });

  test("Filter/subscription relationship", function()
  {
    let filter1 = Filter.fromText("filter1");
    let filter2 = Filter.fromText("filter2");
    let filter3 = Filter.fromText("filter3");

    let subscription1 = Subscription.fromURL("http://test1/");
    subscription1.filters = [filter1, filter2];

    let subscription2 = Subscription.fromURL("http://test2/");
    subscription2.filters = [filter2, filter3];

    let subscription3 = Subscription.fromURL("http://test3/");
    subscription3.filters = [filter1, filter2, filter3];

    compareFilterSubscriptions("Initial filter1 subscriptions", filter1, []);
    compareFilterSubscriptions("Initial filter2 subscriptions", filter2, []);
    compareFilterSubscriptions("Initial filter3 subscriptions", filter3, []);

    FilterStorage.addSubscription(subscription1);

    compareFilterSubscriptions("filter1 subscriptions after adding http://test1/", filter1, [subscription1]);
    compareFilterSubscriptions("filter2 subscriptions after adding http://test1/", filter2, [subscription1]);
    compareFilterSubscriptions("filter3 subscriptions after adding http://test1/", filter3, []);

    FilterStorage.addSubscription(subscription2);

    compareFilterSubscriptions("filter1 subscriptions after adding http://test2/", filter1, [subscription1]);
    compareFilterSubscriptions("filter2 subscriptions after adding http://test2/", filter2, [subscription1, subscription2]);
    compareFilterSubscriptions("filter3 subscriptions after adding http://test2/", filter3, [subscription2]);

    FilterStorage.removeSubscription(subscription1);

    compareFilterSubscriptions("filter1 subscriptions after removing http://test1/", filter1, []);
    compareFilterSubscriptions("filter2 subscriptions after removing http://test1/", filter2, [subscription2]);
    compareFilterSubscriptions("filter3 subscriptions after removing http://test1/", filter3, [subscription2]);

    FilterStorage.updateSubscriptionFilters(subscription3, [filter3]);

    compareFilterSubscriptions("filter1 subscriptions after updating http://test3/ filters", filter1, []);
    compareFilterSubscriptions("filter2 subscriptions after updating http://test3/ filters", filter2, [subscription2]);
    compareFilterSubscriptions("filter3 subscriptions after updating http://test3/ filters", filter3, [subscription2]);

    FilterStorage.addSubscription(subscription3);

    compareFilterSubscriptions("filter1 subscriptions after adding http://test3/", filter1, []);
    compareFilterSubscriptions("filter2 subscriptions after adding http://test3/", filter2, [subscription2]);
    compareFilterSubscriptions("filter3 subscriptions after adding http://test3/", filter3, [subscription2, subscription3]);

    FilterStorage.updateSubscriptionFilters(subscription3, [filter1, filter2]);

    compareFilterSubscriptions("filter1 subscriptions after updating http://test3/ filters", filter1, [subscription3]);
    compareFilterSubscriptions("filter2 subscriptions after updating http://test3/ filters", filter2, [subscription2, subscription3]);
    compareFilterSubscriptions("filter3 subscriptions after updating http://test3/ filters", filter3, [subscription2]);

    FilterStorage.removeSubscription(subscription3);

    compareFilterSubscriptions("filter1 subscriptions after removing http://test3/", filter1, []);
    compareFilterSubscriptions("filter2 subscriptions after removing http://test3/", filter2, [subscription2]);
    compareFilterSubscriptions("filter3 subscriptions after removing http://test3/", filter3, [subscription2]);
  });
})();
