(function()
{
  let testRunner = null;
  let server = null;
  let randomResult = 0.5;

  module("Synchronizer", {
    setup: function()
    {
      testRunner = this;

      prepareFilterComponents.call(this);
      preparePrefs.call(this);
      setupVirtualTime.call(this, function(wrapTimer)
      {
        let SynchronizerModule = getModuleGlobal("synchronizer");
        SynchronizerModule.downloader._timer = wrapTimer(SynchronizerModule.downloader._timer);
      }, "synchronizer", "downloader");

      server = new nsHttpServer();
      server.start(1234);

      // Replace Math.random() function
      let DownloaderGlobal = Cu.getGlobalForObject(getModuleGlobal("downloader"));
      this._origRandom = DownloaderGlobal.Math.random;
      DownloaderGlobal.Math.random = function() randomResult;
      randomResult = 0.5;
    },

    teardown: function()
    {
      restoreFilterComponents.call(this);
      restorePrefs.call(this);
      restoreVirtualTime.call(this);

      stop();
      server.stop(function()
      {
        server = null;
        start();
      });

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

  test("Checksum verification", function()
  {
    let subscription = Subscription.fromURL("http://127.0.0.1:1234/subscription");
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

    function handler(metadata, response)
    {
      response.setStatusLine("1.1", "200", "OK");
      response.setHeader("Content-Type", "text/plain");

      response.bodyOutputStream.write(subscriptionBody, subscriptionBody.length);
    }
    server.registerPathHandler("/subscription", handler);

    for each ([testName, subscriptionBody, expectedResult] in tests)
    {
      resetSubscription(subscription);
      testRunner.runScheduledTasks(2);
      equal(subscription.downloadStatus, expectedResult ? "synchronize_ok" : "synchronize_checksum_mismatch", testName);
    }
  });

  test("Special comments", function()
  {
    let subscription = Subscription.fromURL("http://127.0.0.1:1234/subscription");
    FilterStorage.addSubscription(subscription);

    let comment, check;
    let tests = [
      ["! Homepage: http://example.com/", function() equal(subscription.homepage, "http://example.com/", "Valid homepage comment")],
      ["! Homepage: ssh://example.com/", function() equal(subscription.homepage, null, "Invalid homepage comment")],
      ["! Title: foo", function()
        {
          equal(subscription.title, "foo", "Title comment");
          equal(subscription.fixedTitle, true, "Fixed title");
        }],
      ["! Version: 1234", function() equal(subscription.version, 1234, "Version comment")]
    ];

    function handler(metadata, response)
    {
      response.setStatusLine("1.1", "200", "OK");
      response.setHeader("Content-Type", "text/plain");

      let result = "[Adblock]\n" + comment + "\nfoo\nbar";
      response.bodyOutputStream.write(result, result.length);
    }
    server.registerPathHandler("/subscription", handler);

    for each([comment, check] in tests)
    {
      resetSubscription(subscription);
      testRunner.runScheduledTasks(2);
      check();
      deepEqual(subscription.filters, [Filter.fromText("foo"), Filter.fromText("bar")], "Special comment not added to filters");
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

    server.registerPathHandler("/redirected", function(metadata, response)
    {
      response.setStatusLine("1.1", "200", "OK");
      response.setHeader("Content-Type", "text/plain");

      let result = "[Adblock]\nfoo\n!Redirect: http://127.0.0.1:1234/subscription\nbar";
      response.bodyOutputStream.write(result, result.length);
    })

    let subscription = Subscription.fromURL("http://127.0.0.1:1234/subscription");
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
    Prefs.subscriptions_fallbackurl = "http://127.0.0.1:1234/fallback?%SUBSCRIPTION%&%CHANNELSTATUS%&%RESPONSESTATUS%";

    let subscription = Subscription.fromURL("http://127.0.0.1:1234/subscription");
    FilterStorage.addSubscription(subscription);

    // No valid response from fallback

    let requests = [];
    function handler(metadata, response)
    {
      requests.push(testRunner.getTimeOffset());

      response.setStatusLine("1.1", "404", "Not found");
    }
    server.registerPathHandler("/subscription", handler);

    testRunner.runScheduledTasks(100);
    deepEqual(requests, [0.1, 24.1, 48.1, 72.1, 96.1], "Continue trying if the fallback doesn't respond");

    // Fallback giving "Gone" response

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

    // Fallback redirecting to a missing file

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

    // Fallback redirecting to an existing file

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

    // Checksum mismatch

    function handler2(metadata, response)
    {
      response.setStatusLine("1.1", "200", "OK");
      response.setHeader("Content-Type", "text/plain");

      let result = "[Adblock]\n! Checksum: wrong\nfoo\nbar";
      response.bodyOutputStream.write(result, result.length);
    }
    server.registerPathHandler("/subscription", handler2);

    subscription = Subscription.fromURL("http://127.0.0.1:1234/subscription");
    resetSubscription(subscription);
    FilterStorage.removeSubscription(FilterStorage.subscriptions[0]);
    FilterStorage.addSubscription(subscription);

    testRunner.runScheduledTasks(100);
    equal(FilterStorage.subscriptions[0].url, "http://127.0.0.1:1234/redirected", "Wrong checksum produces fallback request");

    // Redirect loop

    server.registerPathHandler("/subscription", function(metadata, response)
    {
      response.setStatusLine("1.1", "200", "OK");
      response.setHeader("Content-Type", "text/plain");

      let result = "[Adblock]\n! Redirect: http://127.0.0.1:1234/subscription2";
      response.bodyOutputStream.write(result, result.length);
    });
    server.registerPathHandler("/subscription2", function(metadata, response)
    {
      response.setStatusLine("1.1", "200", "OK");
      response.setHeader("Content-Type", "text/plain");

      let result = "[Adblock]\n! Redirect: http://127.0.0.1:1234/subscription";
      response.bodyOutputStream.write(result, result.length);
    });

    subscription = Subscription.fromURL("http://127.0.0.1:1234/subscription");
    resetSubscription(subscription);
    FilterStorage.removeSubscription(FilterStorage.subscriptions[0]);
    FilterStorage.addSubscription(subscription);

    testRunner.runScheduledTasks(100);
    equal(FilterStorage.subscriptions[0].url, "http://127.0.0.1:1234/redirected", "Fallback can still redirect even after a redirect loop");
  });

  test("State fields", function()
  {
    let subscription = Subscription.fromURL("http://127.0.0.1:1234/subscription");
    FilterStorage.addSubscription(subscription);

    server.registerPathHandler("/subscription", function successHandler(metadata, response)
    {
      response.setStatusLine("1.1", "200", "OK");
      response.setHeader("Content-Type", "text/plain");

      let result = "[Adblock]\n! Expires: 2 hours\nfoo\nbar";
      response.bodyOutputStream.write(result, result.length);
    });

    let startTime = testRunner.currentTime;
    testRunner.runScheduledTasks(2);

    equal(subscription.downloadStatus, "synchronize_ok", "downloadStatus after successful download");
    equal(subscription.lastDownload * MILLIS_IN_SECOND, startTime + 0.1 * MILLIS_IN_HOUR, "lastDownload after successful download");
    equal(subscription.lastSuccess * MILLIS_IN_SECOND, startTime + 0.1 * MILLIS_IN_HOUR, "lastSuccess after successful download");
    equal(subscription.lastCheck * MILLIS_IN_SECOND, startTime + 1.1 * MILLIS_IN_HOUR, "lastCheck after successful download");
    equal(subscription.errors, 0, "errors after successful download");

    server.registerPathHandler("/subscription", function errorHandler(metadata, response)
    {
      response.setStatusLine("1.1", "404", "Not Found");
    });

    testRunner.runScheduledTasks(2);

    equal(subscription.downloadStatus, "synchronize_connection_error", "downloadStatus after download error");
    equal(subscription.lastDownload * MILLIS_IN_SECOND, startTime + 2.1 * MILLIS_IN_HOUR, "lastDownload after download error");
    equal(subscription.lastSuccess * MILLIS_IN_SECOND, startTime + 0.1 * MILLIS_IN_HOUR, "lastSuccess after download error");
    equal(subscription.lastCheck * MILLIS_IN_SECOND, startTime + 3.1 * MILLIS_IN_HOUR, "lastCheck after download error");
    equal(subscription.errors, 1, "errors after download error");
  });
})();
