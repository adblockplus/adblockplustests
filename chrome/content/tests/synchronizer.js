(function()
{
  let testRunner = null;
  let requestHandlers = null;
  let randomResult = 0.5;

  module("Synchronizer", {
    setup: function()
    {
      testRunner = this;

      prepareFilterComponents.call(this);
      preparePrefs.call(this);

      Synchronizer.init();

      setupVirtualTime.call(this, function(wrapTimer)
      {
        let SynchronizerModule = getModuleGlobal("synchronizer");
        SynchronizerModule.downloader._timer = wrapTimer(SynchronizerModule.downloader._timer);
      }, "synchronizer", "downloader");
      setupVirtualXMLHttp.call(this, "synchronizer", "downloader");

      // Replace Math.random() function
      let DownloaderGlobal = Cu.getGlobalForObject(getModuleGlobal("downloader"));
      this._origRandom = DownloaderGlobal.Math.random;
      DownloaderGlobal.Math.random = () => randomResult;
      randomResult = 0.5;
    },

    teardown: function()
    {
      restoreFilterComponents.call(this);
      restorePrefs.call(this);
      restoreVirtualTime.call(this);
      restoreVirtualXMLHttp.call(this);

      if (this._origRandom)
      {
        let DownloaderGlobal = Cu.getGlobalForObject(getModuleGlobal("downloader"));
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
      subscription.version = subscription.lastSuccess =
      subscription.expires = subscription.softExpiration = 0;
    subscription.title = "";
    subscription.homepage = null;
    subscription.errors = 0;
    subscription.downloadStatus = null;
    subscription.requiredVersion = null;
  }

  test("Downloads of one subscription", function()
  {
    let subscription = Subscription.fromURL("http://example.com/subscription");
    FilterStorage.addSubscription(subscription);

    let requests = [];
    testRunner.registerHandler("/subscription", function(metadata)
    {
      requests.push([testRunner.getTimeOffset(), metadata.method, metadata.path]);
      return [Cr.NS_OK, 200, "[Adblock]\n! ExPiREs: 1day\nfoo\nbar"];
    });

    testRunner.runScheduledTasks(50);
    deepEqual(requests, [
      [0.1, "GET", "/subscription"],
      [24.1, "GET", "/subscription"],
      [48.1, "GET", "/subscription"],
    ], "Requests after 50 hours");
  });

  test("Downloads of two subscriptions", function()
  {
    let subscription1 = Subscription.fromURL("http://example.com/subscription1");
    FilterStorage.addSubscription(subscription1);

    let subscription2 = Subscription.fromURL("http://example.com/subscription2");
    subscription2.expires =
      subscription2.softExpiration =
      (testRunner.currentTime + 2 * MILLIS_IN_HOUR) / MILLIS_IN_SECOND;
    FilterStorage.addSubscription(subscription2);

    let requests = [];
    function handler(metadata)
    {
      requests.push([testRunner.getTimeOffset(), metadata.method, metadata.path]);
      return [Cr.NS_OK, 200, "[Adblock]\n! ExPiREs: 1day\nfoo\nbar"];
    }

    testRunner.registerHandler("/subscription1", handler);
    testRunner.registerHandler("/subscription2", handler);

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
    let test;
    let subscription = Subscription.fromURL("http://example.com/subscription");
    FilterStorage.addSubscription(subscription);

    testRunner.registerHandler("/subscription", function(metadata)
    {
      return [Cr.NS_OK, 200, test.header + "\n!Expires: 8 hours\nfoo\n!bar\n\n@@bas\n#bam"];
    });

    let tests = [
      {header: "[Adblock]", downloadStatus: "synchronize_ok", requiredVersion: null},
      {header: "[Adblock Plus]", downloadStatus: "synchronize_ok", requiredVersion: null},
      {header: "(something)[Adblock]", downloadStatus: "synchronize_ok", requiredVersion: null},
      {header: "[Adblock Plus 0.0.1]", downloadStatus: "synchronize_ok", requiredVersion: "0.0.1"},
      {header: "[Adblock Plus 99.9]", downloadStatus: "synchronize_ok", requiredVersion: "99.9"},
      {header: "[Foo]", downloadStatus: "synchronize_invalid_data", requiredVersion: null}
    ];
    for (test of tests)
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

    let subscription = Subscription.fromURL("http://example.com/subscription");
    FilterStorage.addSubscription(subscription);

    let requests = 0;
    testRunner.registerHandler("/subscription", function(metadata)
    {
      requests++;
      throw new Error("Unexpected request");
    });

    testRunner.runScheduledTasks(50);
    equal(requests, 0, "Request count");
  });

  test("Expiration time", function()
  {
    let subscription = Subscription.fromURL("http://example.com/subscription");
    FilterStorage.addSubscription(subscription);

    let test;
    let requests = [];
    testRunner.registerHandler("/subscription", function(metadata)
    {
      requests.push(testRunner.getTimeOffset());
      return [Cr.NS_OK, 200, "[Adblock]\nfoo\n!Expires: " + test.expiration + "\nbar"];
    });

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

    for (test of tests)
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

  test("Checksum verification", function()
  {
    let subscription = Subscription.fromURL("http://example.com/subscription");
    FilterStorage.addSubscription(subscription);

    let testName, subscriptionBody, expectedResult;
    let tests = [
      ["Correct checksum", "[Adblock]\n! Checksum: e/JCmqXny6Fn24b7JHsq/A\nfoo\nbar\n", true],
      ["Wrong checksum", "[Adblock]\n! Checksum: wrongggny6Fn24b7JHsq/A\nfoo\nbar\n", false],
      ["Empty lines ignored", "[Adblock]\n! Checksum: e/JCmqXny6Fn24b7JHsq/A\n\nfoo\n\nbar\n\n", true],
      ["CR LF line breaks treated like LR", "[Adblock]\n! Checksum: e/JCmqXny6Fn24b7JHsq/A\nfoo\r\nbar\r\n", true],
      ["CR line breaks treated like LR", "[Adblock]\n! Checksum: e/JCmqXny6Fn24b7JHsq/A\nfoo\rbar\r", true],
      ["Trailing line break not ignored", "[Adblock]\n! Checksum: e/JCmqXny6Fn24b7JHsq/A\nfoo\nbar", false],
      ["Line breaks between lines not ignored", "[Adblock]\n! Checksum: e/JCmqXny6Fn24b7JHsq/A\nfoobar", false],
      ["Lines with spaces not ignored", "[Adblock]\n! Checksum: e/JCmqXny6Fn24b7JHsq/A\n \nfoo\n\nbar\n", false],
      ["Extra content in checksum line is part of the checksum", "[Adblock]\n! Checksum: e/JCmqXny6Fn24b7JHsq/A foobar\nfoo\nbar\n", false],
      ["= symbols after checksum are ignored", "[Adblock]\n! Checksum: e/JCmqXny6Fn24b7JHsq/A===\nfoo\nbar\n", true],
      ["Header line is part of the checksum", "[Adblock Plus]\n! Checksum: e/JCmqXny6Fn24b7JHsq/A\nfoo\nbar\n", false],
      ["Special comments are part of the checksum", "[Adblock]\n! Checksum: e/JCmqXny6Fn24b7JHsq/A\n! Expires: 1\nfoo\nbar\n", false],
    ];

    testRunner.registerHandler("/subscription", function(metadata)
    {
      return [Cr.NS_OK, 200, subscriptionBody];
    });

    for ([testName, subscriptionBody, expectedResult] of tests)
    {
      resetSubscription(subscription);
      testRunner.runScheduledTasks(2);
      equal(subscription.downloadStatus, expectedResult ? "synchronize_ok" : "synchronize_checksum_mismatch", testName);
    }
  });

  test("Special comments", function()
  {
    let subscription = Subscription.fromURL("http://example.com/subscription");
    FilterStorage.addSubscription(subscription);

    let comment, check;
    let tests = [
      ["! Homepage: http://example.com/", () => equal(subscription.homepage, "http://example.com/", "Valid homepage comment")],
      ["! Homepage: ssh://example.com/", () => equal(subscription.homepage, null, "Invalid homepage comment")],
      ["! Title: foo", function()
        {
          equal(subscription.title, "foo", "Title comment");
          equal(subscription.fixedTitle, true, "Fixed title");
        }],
      ["! Version: 1234", () => equal(subscription.version, 1234, "Version comment")]
    ];

    testRunner.registerHandler("/subscription", function(metadata)
    {
      return [Cr.NS_OK, 200, "[Adblock]\n" + comment + "\nfoo\nbar"];
    });

    for ([comment, check] of tests)
    {
      resetSubscription(subscription);
      testRunner.runScheduledTasks(2);
      check();
      deepEqual(subscription.filters, [Filter.fromText("foo"), Filter.fromText("bar")], "Special comment not added to filters");
    }
  });

  test("Redirects", function()
  {
    let subscription = Subscription.fromURL("http://example.com/subscription");
    FilterStorage.addSubscription(subscription);

    testRunner.registerHandler("/subscription", function(metadata)
    {
      return [Cr.NS_OK, 200, "[Adblock]\nfoo\n!Redirect: http://example.com/redirected\nbar"];
    });

    testRunner.runScheduledTasks(30);
    equal(FilterStorage.subscriptions[0], subscription, "Invalid redirect ignored");
    equal(subscription.downloadStatus, "synchronize_connection_error", "Connection error recorded");
    equal(subscription.errors, 2, "Number of download errors");

    let requests = [];
    testRunner.registerHandler("/redirected", function(metadata)
    {
      requests.push(testRunner.getTimeOffset());
      return [Cr.NS_OK, 200, "[Adblock]\nfoo\n! Expires: 8 hours\nbar"];
    });

    resetSubscription(subscription);
    testRunner.runScheduledTasks(15);
    equal(FilterStorage.subscriptions[0].url, "http://example.com/redirected", "Redirect followed");
    deepEqual(requests, [0.1, 8.1], "Resulting requests");

    testRunner.registerHandler("/redirected", function(metadata)
    {
      return [Cr.NS_OK, 200, "[Adblock]\nfoo\n!Redirect: http://example.com/subscription\nbar"];
    })

    subscription = Subscription.fromURL("http://example.com/subscription");
    resetSubscription(subscription);
    FilterStorage.removeSubscription(FilterStorage.subscriptions[0]);
    FilterStorage.addSubscription(subscription);

    testRunner.runScheduledTasks(2);
    equal(FilterStorage.subscriptions[0], subscription, "Redirect not followed on redirect loop");
    equal(subscription.downloadStatus, "synchronize_connection_error", "Download status after redirect loop");
  });

  test("Fallback", function()
  {
    Prefs.subscriptions_fallbackerrors = 3;
    Prefs.subscriptions_fallbackurl = "http://example.com/fallback?%SUBSCRIPTION%&%CHANNELSTATUS%&%RESPONSESTATUS%";

    let subscription = Subscription.fromURL("http://example.com/subscription");
    FilterStorage.addSubscription(subscription);

    // No valid response from fallback

    let requests = [];
    testRunner.registerHandler("/subscription", function(metadata)
    {
      requests.push(testRunner.getTimeOffset());
      return [Cr.NS_OK, 404, ""];
    });

    testRunner.runScheduledTasks(100);
    deepEqual(requests, [0.1, 24.1, 48.1, 72.1, 96.1], "Continue trying if the fallback doesn't respond");

    // Fallback giving "Gone" response

    resetSubscription(subscription);
    requests = [];
    fallbackParams = null;
    testRunner.registerHandler("/fallback", function(metadata)
    {
      fallbackParams = decodeURIComponent(metadata.queryString);
      return [Cr.NS_OK, 200, "410 Gone"];
    });

    testRunner.runScheduledTasks(100);
    deepEqual(requests, [0.1, 24.1, 48.1], "Stop trying if the fallback responds with Gone");
    equal(fallbackParams, "http://example.com/subscription&0&404", "Fallback arguments");

    // Fallback redirecting to a missing file

    subscription = Subscription.fromURL("http://example.com/subscription");
    resetSubscription(subscription);
    FilterStorage.removeSubscription(FilterStorage.subscriptions[0]);
    FilterStorage.addSubscription(subscription);
    requests = [];

    testRunner.registerHandler("/fallback", function(metadata)
    {
      return [Cr.NS_OK, 200, "301 http://example.com/redirected"];
    });
    testRunner.runScheduledTasks(100);
    equal(FilterStorage.subscriptions[0].url, "http://example.com/subscription", "Ignore invalid redirect from fallback");
    deepEqual(requests, [0.1, 24.1, 48.1, 72.1, 96.1], "Requests not affected by invalid redirect");

    // Fallback redirecting to an existing file

    resetSubscription(subscription);
    requests = [];
    let redirectedRequests = [];
    testRunner.registerHandler("/redirected", function(metadata)
    {
      redirectedRequests.push(testRunner.getTimeOffset());
      return [Cr.NS_OK, 200, "[Adblock]\n!Expires: 1day\nfoo\nbar"];
    });

    testRunner.runScheduledTasks(100);
    equal(FilterStorage.subscriptions[0].url, "http://example.com/redirected", "Valid redirect from fallback is followed");
    deepEqual(requests, [0.1, 24.1, 48.1], "Stop polling original URL after a valid redirect from fallback");
    deepEqual(redirectedRequests, [48.1, 72.1, 96.1], "Request new URL after a valid redirect from fallback");

    // Checksum mismatch

    testRunner.registerHandler("/subscription", function(metadata)
    {
      return [Cr.NS_OK, 200, "[Adblock]\n! Checksum: wrong\nfoo\nbar"];
    });

    subscription = Subscription.fromURL("http://example.com/subscription");
    resetSubscription(subscription);
    FilterStorage.removeSubscription(FilterStorage.subscriptions[0]);
    FilterStorage.addSubscription(subscription);

    testRunner.runScheduledTasks(100);
    equal(FilterStorage.subscriptions[0].url, "http://example.com/redirected", "Wrong checksum produces fallback request");

    // Redirect loop

    testRunner.registerHandler("/subscription", function(metadata)
    {
      return [Cr.NS_OK, 200, "[Adblock]\n! Redirect: http://example.com/subscription2"];
    });
    testRunner.registerHandler("/subscription2", function(metadata, response)
    {
      return [Cr.NS_OK, 200, "[Adblock]\n! Redirect: http://example.com/subscription"];
    });

    subscription = Subscription.fromURL("http://example.com/subscription");
    resetSubscription(subscription);
    FilterStorage.removeSubscription(FilterStorage.subscriptions[0]);
    FilterStorage.addSubscription(subscription);

    testRunner.runScheduledTasks(100);
    equal(FilterStorage.subscriptions[0].url, "http://example.com/redirected", "Fallback can still redirect even after a redirect loop");
  });

  test("State fields", function()
  {
    let subscription = Subscription.fromURL("http://example.com/subscription");
    FilterStorage.addSubscription(subscription);

    testRunner.registerHandler("/subscription", function(metadata)
    {
      return [Cr.NS_OK, 200, "[Adblock]\n! Expires: 2 hours\nfoo\nbar"];
    });

    let startTime = testRunner.currentTime;
    testRunner.runScheduledTasks(2);

    equal(subscription.downloadStatus, "synchronize_ok", "downloadStatus after successful download");
    equal(subscription.lastDownload * MILLIS_IN_SECOND, startTime + 0.1 * MILLIS_IN_HOUR, "lastDownload after successful download");
    equal(subscription.lastSuccess * MILLIS_IN_SECOND, startTime + 0.1 * MILLIS_IN_HOUR, "lastSuccess after successful download");
    equal(subscription.lastCheck * MILLIS_IN_SECOND, startTime + 1.1 * MILLIS_IN_HOUR, "lastCheck after successful download");
    equal(subscription.errors, 0, "errors after successful download");

    testRunner.registerHandler("/subscription", function(metadata)
    {
      return [Cr.NS_ERROR_FAILURE, 0, ""];
    });

    testRunner.runScheduledTasks(2);

    equal(subscription.downloadStatus, "synchronize_connection_error", "downloadStatus after connection error");
    equal(subscription.lastDownload * MILLIS_IN_SECOND, startTime + 2.1 * MILLIS_IN_HOUR, "lastDownload after connection error");
    equal(subscription.lastSuccess * MILLIS_IN_SECOND, startTime + 0.1 * MILLIS_IN_HOUR, "lastSuccess after connection error");
    equal(subscription.lastCheck * MILLIS_IN_SECOND, startTime + 3.1 * MILLIS_IN_HOUR, "lastCheck after connection error");
    equal(subscription.errors, 1, "errors after connection error");

    testRunner.registerHandler("/subscription", function(metadata)
    {
      return [Cr.NS_OK, 404, ""];
    });

    testRunner.runScheduledTasks(24);

    equal(subscription.downloadStatus, "synchronize_connection_error", "downloadStatus after download error");
    equal(subscription.lastDownload * MILLIS_IN_SECOND, startTime + 26.1 * MILLIS_IN_HOUR, "lastDownload after download error");
    equal(subscription.lastSuccess * MILLIS_IN_SECOND, startTime + 0.1 * MILLIS_IN_HOUR, "lastSuccess after download error");
    equal(subscription.lastCheck * MILLIS_IN_SECOND, startTime + 27.1 * MILLIS_IN_HOUR, "lastCheck after download error");
    equal(subscription.errors, 2, "errors after download error");
  });
})();
