(function()
{
  module("Filter notifier", {setup: prepareFilterComponents, teardown: restoreFilterComponents});

  let triggeredListeners = [];
  let listeners = [
    (action, item) => triggeredListeners.push(["listener1", action, item]),
    (action, item) => triggeredListeners.push(["listener2", action, item]),
    (action, item) => triggeredListeners.push(["listener3", action, item])
  ];

  function compareListeners(test, list)
  {
    let result1 = triggeredListeners = [];
    FilterNotifier.triggerListeners("foo", {bar: true});

    let result2 = triggeredListeners = [];
    for (let observer of list)
      observer("foo", {bar: true});

    deepEqual(result1, result2, test);
  }

  test("Adding/removing listeners", function()
  {
    let [listener1, listener2, listener3] = listeners;

    compareListeners("No listeners", []);

    FilterNotifier.addListener(listener1);
    compareListeners("addListener(listener1)", [listener1]);

    FilterNotifier.addListener(listener1);
    compareListeners("addListener(listener1) again", [listener1]);

    FilterNotifier.addListener(listener2);
    compareListeners("addListener(listener2)", [listener1, listener2]);

    FilterNotifier.removeListener(listener1);
    compareListeners("removeListener(listener1)", [listener2]);

    FilterNotifier.removeListener(listener1);
    compareListeners("removeListener(listener1) again", [listener2]);

    FilterNotifier.addListener(listener3);
    compareListeners("addListener(listener3)", [listener2, listener3]);

    FilterNotifier.addListener(listener1);
    compareListeners("addListener(listener1)", [listener2, listener3, listener1]);

    FilterNotifier.removeListener(listener3);
    compareListeners("removeListener(listener3)", [listener2, listener1]);

    FilterNotifier.removeListener(listener1);
    compareListeners("removeListener(listener1)", [listener2]);

    FilterNotifier.removeListener(listener2);
    compareListeners("removeListener(listener2)", []);
  });

  test("Removing listeners while being called", function()
  {
    let listener1 = function()
    {
      listeners[0].apply(this, arguments);
      FilterNotifier.removeListener(listener1);
    };
    let listener2 = listeners[1];
    FilterNotifier.addListener(listener1);
    FilterNotifier.addListener(listener2);

    compareListeners("Initial call", [listener1, listener2]);
    compareListeners("Subsequent calls", [listener2]);
  });
})();
