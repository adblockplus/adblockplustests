(function()
{
  let testRunner = null;
  let server = null;
  let randomResult = 0.5;

  const MILLIS_IN_SECOND = 1000;
  const MILLIS_IN_MINUTE = 60 * MILLIS_IN_SECOND;
  const MILLIS_IN_HOUR = 60 * MILLIS_IN_MINUTE;
  const MILLIS_IN_DAY = 24 * MILLIS_IN_HOUR;

  module("Synchronizer", {
    QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver, Ci.nsISupportsWeakReference]),

    setup: function()
    {
      testRunner = this;

      prepareFilterComponents.call(this);
      preparePrefs.call(this);

      let SynchronizerGlobal = Cu.getGlobalForObject(Synchronizer);
      let SynchronizerModule = getModuleGlobal("synchronizer");
      let DownloaderGlobal = Cu.getGlobalForObject(SynchronizerModule.downloader);

      server = new nsHttpServer();
      server.start(1234);

      let currentTime = 100000 * MILLIS_IN_HOUR;
      let startTime = currentTime;
      let scheduledTasks = [];

      // Replace Date.now() function
      this._origNow = SynchronizerGlobal.Date.now;
      SynchronizerGlobal.Date.now = DownloaderGlobal.Date.now = function() currentTime;

      // Replace Math.random() function
      this._origRandom = DownloaderGlobal.Math.random;
      DownloaderGlobal.Math.random = function() randomResult;

      // Replace global timer variable
      let timer = {__proto__: SynchronizerModule.downloader._timer, delay: 0.1 * MILLIS_IN_HOUR};
      let callback = timer.callback;
      timer.handler = function() { callback.notify(timer); };
      timer.nextExecution = currentTime + timer.delay;
      scheduledTasks.push(timer);
      SynchronizerModule.downloader._timer.cancel();
      SynchronizerModule.downloader._timer = timer;

      // Register observer to track outstanding requests
      this._outstandingRequests = 0;
      Services.obs.addObserver(this, "http-on-modify-request", true);
      Services.obs.addObserver(this, "http-on-examine-response", true);

      this.runScheduledTasks = function(maxHours, initial, skip)
      {
        if (typeof maxHours != "number")
          throw new Error("Numerical parameter expected");
        if (typeof initial != "number")
          initial = 0;
        if (typeof skip != "number")
          skip = 0;

        startTime = currentTime;
        if (initial >= 0)
        {
          this._runScheduledTasks(initial);
          maxHours -= initial;
        }
        if (skip)
        {
          this._skipTasks(skip);
          maxHours -= skip;
        }
        this._runScheduledTasks(maxHours);
      }

      this._runScheduledTasks = function(maxHours)
      {
        let endTime = currentTime + maxHours * MILLIS_IN_HOUR;
        while (true)
        {
          let nextTask = null;
          for each (let task in scheduledTasks)
          {
            if (!nextTask || nextTask.nextExecution > task.nextExecution)
              nextTask = task;
          }
          if (!nextTask || nextTask.nextExecution > endTime)
            break;

          currentTime = nextTask.nextExecution;
          nextTask.handler();

          // Let all asynchronous actions finish
          let thread = Services.tm.currentThread;
          let loopStartTime = Date.now();

          while (this._outstandingRequests > 0 || thread.hasPendingEvents())
          {
            thread.processNextEvent(true);

            if (Date.now() - loopStartTime > 5000)
              throw new Error("Synchronizer stuck downloading subscriptions");
          }

          if (nextTask.type == Components.interfaces.nsITimer.TYPE_ONE_SHOT)
            scheduledTasks = scheduledTasks.filter(function(task) task != nextTask);
          else
            nextTask.nextExecution = currentTime + nextTask.delay;
        }

        currentTime = endTime;
      }

      this._skipTasks = function(hours)
      {
        let newTasks = [];
        currentTime += hours * MILLIS_IN_HOUR;
        for each (let task in scheduledTasks)
        {
          if (task.nextExecution >= currentTime)
            newTasks.push(task);
          else if (task.type != Components.interfaces.nsITimer.TYPE_ONE_SHOT)
          {
            task.nextExecution = currentTime;
            newTasks.push(task);
          }
        }
        scheduledTasks = newTasks;
      }

      this.getTimeOffset = function() (currentTime - startTime) / MILLIS_IN_HOUR;

      this.__defineGetter__("currentTime", function() currentTime);
    },

    observe: function(subject, topic, data)
    {
      let orig = this._outstandingRequests;
      if (topic == "http-on-modify-request")
        this._outstandingRequests++;
      else if (topic == "http-on-examine-response")
        this._outstandingRequests--;
    },

    teardown: function()
    {
      restoreFilterComponents.call(this);
      restorePrefs.call(this);

      stop();
      server.stop(function()
      {
        server = null;
        start();
      });

      if (this._origNow)
      {
        let SynchronizerGlobal = Cu.getGlobalForObject(Synchronizer);
        let SynchronizerModule = getModuleGlobal("synchronizer");
        let DownloaderGlobal = Cu.getGlobalForObject(SynchronizerModule.downloader);
        SynchronizerGlobal.Date.now = DownloaderGlobal.Date.now = this._origNow;
        delete this._origNow;
      }

      if (this._origRandom)
      {
        let SynchronizerModule = getModuleGlobal("synchronizer");
        let DownloaderGlobal = Cu.getGlobalForObject(SynchronizerModule.downloader);
        DownloaderGlobal.Math.random = this._origRandom;
        delete this._origRandom;
      }

      Synchronizer.init();
    }
  });

  function resetSubscription(subscription)
  {
    FilterStorage.updateSubscriptionFilters(subscription, []);
    subscription.lastCheck =  subscription.lastDownload =
      subscription.lastVersion = subscription.lastSuccess =
      subscription.expires = subscription.softExpiration = 0;
    subscription.errors = 0;
    subscription.downloadStatus = null;
    subscription.requiredVersion = null;
  }

  test("Downloads of one subscription", function()
  {
    // Always use average download interval
    randomResult = 0.5;

    let subscription = Subscription.fromURL("http://127.0.0.1:1234/subscription");
    FilterStorage.addSubscription(subscription);

    let requests = [];
    function handler(metadata, response)
    {
      requests.push([testRunner.getTimeOffset(), metadata.method, metadata.path]);

      response.setStatusLine("1.1", "200", "OK");
      response.setHeader("Content-Type", "text/plain");

      let result = "[Adblock]\n! ExPiREs: 1day\nfoo\nbar";
      response.bodyOutputStream.write(result, result.length);
    }

    server.registerPathHandler("/subscription", handler);

    testRunner.runScheduledTasks(50);
    deepEqual(requests, [
      [0.1, "GET", "/subscription"],
      [24.1, "GET", "/subscription"],
      [48.1, "GET", "/subscription"],
    ], "Requests after 50 hours");
  });

  test("Downloads of two subscriptions", function()
  {
    // Always use average download interval
    randomResult = 0.5;

    let subscription1 = Subscription.fromURL("http://127.0.0.1:1234/subscription1");
    FilterStorage.addSubscription(subscription1);

    let subscription2 = Subscription.fromURL("http://127.0.0.1:1234/subscription2");
    subscription2.expires =
      subscription2.softExpiration =
      (testRunner.currentTime + 2 * MILLIS_IN_HOUR) / MILLIS_IN_SECOND;
    FilterStorage.addSubscription(subscription2);

    let requests = [];
    function handler(metadata, response)
    {
      requests.push([testRunner.getTimeOffset(), metadata.method, metadata.path]);

      response.setStatusLine("1.1", "200", "OK");
      response.setHeader("Content-Type", "text/plain");

      let result = "[Adblock]\n! ExPiREs: 1day\nfoo\nbar";
      response.bodyOutputStream.write(result, result.length);
    }

    server.registerPathHandler("/subscription1", handler);
    server.registerPathHandler("/subscription2", handler);

    testRunner.runScheduledTasks(55);
    deepEqual(requests, [
      [0.1, "GET", "/subscription1"],
      [2.1, "GET", "/subscription2"],
      [24.1, "GET", "/subscription1"],
      [26.1, "GET", "/subscription2"],
      [48.1, "GET", "/subscription1"],
      [50.1, "GET", "/subscription2"],
    ], "Requests after 55 hours");
  });

  test("Download result, various subscription headers", function()
  {
    // Always use average download interval
    randomResult = 0.5;

    let test;
    let subscription = Subscription.fromURL("http://127.0.0.1:1234/subscription");
    FilterStorage.addSubscription(subscription);

    function handler(metadata, response)
    {
      response.setStatusLine("1.1", "200", "OK");

      // Wrong content type shouldn't matter
      response.setHeader("Content-Type", "text/xml");

      let result = test.header + "\n!Expires: 8 hours\nfoo\n!bar\n\n@@bas\n#bam";
      response.bodyOutputStream.write(result, result.length);
    }
    server.registerPathHandler("/subscription", handler);

    let tests = [
      {header: "[Adblock]", downloadStatus: "synchronize_ok", requiredVersion: null},
      {header: "[Adblock Plus]", downloadStatus: "synchronize_ok", requiredVersion: null},
      {header: "(something)[Adblock]", downloadStatus: "synchronize_ok", requiredVersion: null},
      {header: "[Adblock Plus 0.0.1]", downloadStatus: "synchronize_ok", requiredVersion: "0.0.1"},
      {header: "[Adblock Plus 99.9]", downloadStatus: "synchronize_ok", requiredVersion: "99.9"},
      {header: "[Foo]", downloadStatus: "synchronize_invalid_data", requiredVersion: null}
    ];
    for each (test in tests)
    {
      resetSubscription(subscription)
      testRunner.runScheduledTasks(2);

      equal(subscription.downloadStatus, test.downloadStatus, "Download status for " + test.header)
      equal(subscription.requiredVersion, test.requiredVersion, "Required version for " + test.header)

      if (test.downloadStatus == "synchronize_ok")
      {
        deepEqual(subscription.filters, [
          Filter.fromText("foo"),
          Filter.fromText("!bar"),
          Filter.fromText("@@bas"),
          Filter.fromText("#bam"),
        ], "Resulting subscription filters for " + test.header);
      }
      else
      {
        deepEqual(subscription.filters, [
        ], "Resulting subscription filters for " + test.header);
      }
    }
  })

  test("Automatic updates disabled", function()
  {
    Prefs.subscriptions_autoupdate = false;

    let subscription = Subscription.fromURL("http://127.0.0.1:1234/subscription");
    FilterStorage.addSubscription(subscription);

    let requests = 0;
    function handler(metadata, response)
    {
      requests++;
      throw new Error("Unexpected request");
    }

    server.registerPathHandler("/subscription", handler);

    testRunner.runScheduledTasks(50);
    equal(requests, 0, "Request count");
  });

  test("Expiration time", function()
  {
    let subscription = Subscription.fromURL("http://127.0.0.1:1234/subscription");
    FilterStorage.addSubscription(subscription);

    let test;
    let requests = [];
    function handler(metadata, response)
    {
      requests.push(testRunner.getTimeOffset());

      response.setStatusLine("1.1", "200", "OK");
      response.setHeader("Content-Type", "text/plain");

      let result = "[Adblock]\nfoo\n!Expires: " + test.expiration + "\nbar";
      response.bodyOutputStream.write(result, result.length);
    }
    server.registerPathHandler("/subscription", handler);

    let tests = [
      {
        expiration: "default",
        randomResult: 0.5,
        requests: [0.1, 5 * 24 + 0.1]
      },
      {
        expiration: "1 hours",  // Minimal expiration interval
        randomResult: 0.5,
        requests: [0.1, 1.1, 2.1, 3.1]
      },
      {
        expiration: "26 hours",
        randomResult: 0.5,
        requests: [0.1, 26.1]
      },
      {
        expiration: "2 days",
        randomResult: 0.5,
        requests: [0.1, 48.1]
      },
      {
        expiration: "20 days",  // Too large, will be corrected
        randomResult: 0.5,
        requests: [0.1, 14 * 24 + 0.1]
      },
      {
        expiration: "35 hours",
        randomResult: 0,        // Changes interval by factor 0.8
        requests: [0.1, 28.1]
      },
      {
        expiration: "35 hours",
        randomResult: 1,        // Changes interval by factor 1.2
        requests: [0.1, 42.1]
      },
      {
        expiration: "35 hours",
        randomResult: 0.25,     // Changes interval by factor 0.9
        requests: [0.1, 32.1]
      },
      {
        expiration: "40 hours",
        randomResult: 0.5,
        skipAfter: 5.1,
        skip: 10,               // Short break should not increase soft expiration
        requests: [0.1, 40.1]
      },
      {
        expiration: "40 hours",
        randomResult: 0.5,
        skipAfter: 5.1,
        skip: 30,               // Long break should increase soft expiration
        requests: [0.1, 70.1]
      },
      {
        expiration: "40 hours",
        randomResult: 0.5,
        skipAfter: 5.1,
        skip: 80,               // Hitting hard expiration, immediate download
        requests: [0.1, 85.1]
      }
    ]

    for each (test in tests)
    {
      requests = [];
      randomResult = test.randomResult;
      resetSubscription(subscription);

      let maxHours = Math.round(Math.max.apply(null, test.requests)) + 1;
      testRunner.runScheduledTasks(maxHours, test.skipAfter, test.skip);

      let randomAddendum = (randomResult == 0.5 ? "" : " with Math.random() returning " + randomResult);
      let skipAddendum = (typeof test.skip != "number" ? "" : " skipping " + test.skip + " hours after " + test.skipAfter + " hours");
      deepEqual(requests, test.requests, "Requests for \"" + test.expiration + "\"" + randomAddendum + skipAddendum);
    }
  });

  test("Redirects", function()
  {
    let subscription = Subscription.fromURL("http://127.0.0.1:1234/subscription");
    FilterStorage.addSubscription(subscription);

    function redirect_handler(metadata, response)
    {
      response.setStatusLine("1.1", "200", "OK");
      response.setHeader("Content-Type", "text/plain");

      let result = "[Adblock]\nfoo\n!Redirect: http://127.0.0.1:1234/redirected\nbar";
      response.bodyOutputStream.write(result, result.length);
    }
    server.registerPathHandler("/subscription", redirect_handler);

    testRunner.runScheduledTasks(30);
    equal(FilterStorage.subscriptions[0], subscription, "Invalid redirect ignored");
    equal(subscription.downloadStatus, "synchronize_connection_error", "Connection error recorded");
    equal(subscription.errors, 2, "Number of download errors");

    let requests = [];
    function handler(metadata, response)
    {
      requests.push(testRunner.getTimeOffset());

      response.setStatusLine("1.1", "200", "OK");
      response.setHeader("Content-Type", "text/plain");

      let result = "[Adblock]\nfoo\n! Expires: 8 hours\nbar";
      response.bodyOutputStream.write(result, result.length);
    }
    server.registerPathHandler("/redirected", handler);

    resetSubscription(subscription);
    testRunner.runScheduledTasks(15);
    equal(FilterStorage.subscriptions[0].url, "http://127.0.0.1:1234/redirected", "Redirect followed");
    deepEqual(requests, [0.1, 8.1], "Resulting requests");
  });

  test("Fallback", function()
  {
    Prefs.subscriptions_fallbackerrors = 3;
    Prefs.subscriptions_fallbackurl = "http://127.0.0.1:1234/fallback?%SUBSCRIPTION%&%CHANNELSTATUS%&%RESPONSESTATUS%";

    let subscription = Subscription.fromURL("http://127.0.0.1:1234/subscription");
    FilterStorage.addSubscription(subscription);

    let requests = [];
    function handler(metadata, response)
    {
      requests.push(testRunner.getTimeOffset());

      response.setStatusLine("1.1", "404", "Not found");
    }
    server.registerPathHandler("/subscription", handler);

    testRunner.runScheduledTasks(100);
    deepEqual(requests, [0.1, 24.1, 48.1, 72.1, 96.1], "Continue trying if the fallback doesn't respond");

    resetSubscription(subscription);
    requests = [];
    fallbackParams = null;
    server.registerPathHandler("/fallback", function(metadata, response)
    {
      response.setStatusLine("1.1", "200", "OK");
      fallbackParams = decodeURIComponent(metadata.queryString);

      let result = "410 Gone";
      response.bodyOutputStream.write(result, result.length);
    });

    testRunner.runScheduledTasks(100);
    deepEqual(requests, [0.1, 24.1, 48.1], "Stop trying if the fallback responds with Gone");
    equal(fallbackParams, "http://127.0.0.1:1234/subscription&0&404", "Fallback arguments");

    subscription = Subscription.fromURL("http://127.0.0.1:1234/subscription");
    resetSubscription(subscription);
    FilterStorage.removeSubscription(FilterStorage.subscriptions[0]);
    FilterStorage.addSubscription(subscription);
    requests = [];

    server.registerPathHandler("/fallback", function(metadata, response)
    {
      response.setStatusLine("1.1", "200", "OK");

      let result = "301 http://127.0.0.1:1234/redirected";
      response.bodyOutputStream.write(result, result.length);
    });
    testRunner.runScheduledTasks(100);
    equal(FilterStorage.subscriptions[0].url, "http://127.0.0.1:1234/subscription", "Ignore invalid redirect from fallback");
    deepEqual(requests, [0.1, 24.1, 48.1, 72.1, 96.1], "Requests not affected by invalid redirect");

    resetSubscription(subscription);
    requests = [];
    let redirectedRequests = [];
    server.registerPathHandler("/redirected", function(metadata, response)
    {
      redirectedRequests.push(testRunner.getTimeOffset());

      response.setStatusLine("1.1", "200", "OK");
      response.setHeader("Content-Type", "text/plain");

      let result = "[Adblock]\n!Expires: 1day\nfoo\nbar";
      response.bodyOutputStream.write(result, result.length);
    });

    testRunner.runScheduledTasks(100);
    equal(FilterStorage.subscriptions[0].url, "http://127.0.0.1:1234/redirected", "Valid redirect from fallback is followed");
    deepEqual(requests, [0.1, 24.1, 48.1], "Stop polling original URL after a valid redirect from fallback");
    deepEqual(redirectedRequests, [48.1, 72.1, 96.1], "Request new URL after a valid redirect from fallback");
  });

  // TODO: Checksum verification
})();
