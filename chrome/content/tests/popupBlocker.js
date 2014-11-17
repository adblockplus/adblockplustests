(function()
{
  let server = null;
  let wnd = null;
  let tab = null;

  module("Pop-up blocker", {
    setup: function()
    {
      prepareFilterComponents.call(this, true);
      preparePrefs.call(this);

      server = new nsHttpServer();
      server.start(1234);

      server.registerPathHandler("/test", function(metadata, response)
      {
        response.setStatusLine("1.1", "200", "OK");
        response.setHeader("Content-Type", "text/html; charset=utf-8");

        let body =
          '<body onload="document.dispatchEvent(new CustomEvent(\'abp:frameready\', {bubbles: true}));">' +
            '<a id="link" href="/redirect" target="_blank">link</a>' +
          '</body>';
        response.bodyOutputStream.write(body, body.length);
      });
      server.registerPathHandler("/redirect", function(metadata, response)
      {
        response.setStatusLine("1.1", "302", "Moved Temporarily");
        response.setHeader("Location", "http://127.0.0.1:1234/target");
      });
      server.registerPathHandler("/target", function(metadata, response)
      {
        response.setHeader("Content-Type", "text/html; charset=utf-8");

        let body = '<html><body>OK</body></html>';
        response.bodyOutputStream.write(body, body.length);
      });

      wnd = UI.currentWindow;
      tab = wnd.gBrowser.loadOneTab("http://127.0.0.1:1234/test", {inBackground: false});
      wnd.gBrowser.getBrowserForTab(tab).addEventListener("abp:frameready", function(event)
      {
        start();
      }, false, true);

      stop();
    },
    teardown: function()
    {
      restoreFilterComponents.call(this);
      restorePrefs.call(this);

      stop();
      server.stop(function()
      {
        wnd.gBrowser.removeTab(tab);

        server = null;
        frame = null;

        start();
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

    function onTabOpen(event)
    {
      window.clearTimeout(timeout);
      wnd.gBrowser.tabContainer.removeEventListener("TabOpen", onTabOpen, false);

      let tab = event.target;
      let browser = wnd.gBrowser.getBrowserForTab(tab);
      Utils.runAsync(function()
      {
        browser.contentWindow.addEventListener("load", function(event)
        {
          if (browser.contentDocument.body.textContent.indexOf("OK") >= 0)
            successful = true;

          browser.contentWindow.close();
        }, false);
      });
    }

    function onTabClose(event)
    {
      wnd.gBrowser.tabContainer.removeEventListener("TabClose", onTabClose, false);
      ok(result == successful, "Opening tab with filter " + filter.text);
      var keys = [];
      for (let key in defaultMatcher.blacklist.keywordByFilter)
        keys.push(key);

      FilterStorage.removeFilter(filter);
      start();
    }

    wnd.gBrowser.tabContainer.addEventListener("TabOpen", onTabOpen, false);
    wnd.gBrowser.tabContainer.addEventListener("TabClose", onTabClose, false);
    let timeout = window.setTimeout(onTabClose, 1000);    // In case the tab isn't opened

    wnd.gBrowser.getBrowserForTab(tab).contentDocument.getElementById("link").click();
  }

  for (let [filter, result] of tests)
    asyncTest(filter, runTest.bind(null, Filter.fromText(filter), result));
})();
