(function()
{
  let tabs = SDK.require("sdk/tabs");
  let server = null;
  let tab = null;

  module("Pop-up blocker", {
    beforeEach: function()
    {
      prepareFilterComponents.call(this, true);
      preparePrefs.call(this);

      server = new nsHttpServer();
      server.start(1234);

      // '/test' serves an html page with a single link
      server.registerPathHandler("/test", function(metadata, response)
      {
        response.setStatusLine("1.1", "200", "OK");
        response.setHeader("Content-Type", "text/html; charset=utf-8");

        let body =
          '<body>' +
            '<a id="link" href="/redirect" target="_blank">link</a>' +
          '</body>';
        response.bodyOutputStream.write(body, body.length);
      });

      // redirects '/redirect' to '/target'
      server.registerPathHandler("/redirect", function(metadata, response)
      {
        response.setStatusLine("1.1", "302", "Moved Temporarily");
        response.setHeader("Location", "http://127.0.0.1:1234/target");
      });

      // '/target' serves an html page with 'OK' message
      server.registerPathHandler("/target", function(metadata, response)
      {
        response.setHeader("Content-Type", "text/html; charset=utf-8");

        let body = '<html><body>OK</body></html>';
        response.bodyOutputStream.write(body, body.length);
      });

      tabs.open({
        url: "http://127.0.0.1:1234/test",
        inBackground: false,
        onReady: function(aTab)
        {
          tab = aTab;
          start();
        }
      });

      stop();
    },
    afterEach: function()
    {
      restoreFilterComponents.call(this);
      restorePrefs.call(this);

      stop();
      server.stop(function()
      {
        tab.close(function()
        {
          server = null;
          start();
        });
      });
    }
  });

  let tests = [
    ["||127.0.0.1:1234/target$popup", false],
    ["||127.0.0.1:1234/target$~subdocument", true],
    ["||127.0.0.1:1234/target$popup,domain=127.0.0.1", false],
    ["||127.0.0.1:1234/target$popup,domain=128.0.0.1", true],
    ["||127.0.0.1:1234/redirect$popup", false],
    ["||127.0.0.1:1234/redirect$~subdocument", true],
    ["||127.0.0.1:1234/redirect$popup,domain=127.0.0.1", false],
    ["||127.0.0.1:1234/redirect$popup,domain=128.0.0.1", true],
  ];

  function runTest(filter, result)
  {
    FilterStorage.addFilter(filter);

    let successful = false;

    function onTabOpen(tab)
    {
      tabs.off("ready", onTabOpen);

      // link in '/test' was clicked
      tab.on("close", onTabClose);
      window.clearTimeout(timeout);

      var worker = tab.attach({
        contentScriptWhen: "ready",
        contentScript: "self.port.emit('done', document.body.textContent);"
      });

      worker.port.once("done", function(bodyText)
      {
        if (bodyText.indexOf("OK") >= 0)
          successful = true;

        // pop-up was not blocked so close it
        tab.close();
      });
    }
    tabs.on("ready", onTabOpen);

    function onTabClose(tab)
    {
      tabs.off("ready", onTabOpen);
      if (tab)
        tab.off("close", onTabClose);

      ok(result == successful, "Opening tab with filter " + filter.text);

      FilterStorage.removeFilter(filter);

      start();
    }

    // In case the tab isn't opened
    let timeout = window.setTimeout(onTabClose, 1000, null);

    // click the link in the '/test' tab opened before the test
    var worker = tab.attach({
      contentScriptWhen: "ready",
      contentScript: "(" + function()
      {
        document.getElementById('link').click();
      } + ")()"
    });
  }

  for (let [filter, result] of tests)
    asyncTest(filter, runTest.bind(null, Filter.fromText(filter), result));
})();
