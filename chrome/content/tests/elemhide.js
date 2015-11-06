(function()
{
  let server = null;
  let frame = null;

  module("Element hiding", {
    setup: function()
    {
      prepareFilterComponents.call(this);
      preparePrefs.call(this);

      server = new nsHttpServer();
      server.start(1234);

      server.registerPathHandler("/test", function(metadata, response)
      {
        let body =
          '<body onload="document.dispatchEvent(new CustomEvent(\'abp:frameready\', {bubbles: true}));">' +
            '<div id="test1" class="testClass">foo</div>' +
            '<p id="test2" class="testClass">bar</p>' +
          '</body>';
        response.setStatusLine("1.1", "200", "OK");
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.bodyOutputStream.write(body, body.length);
      });

      frame = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "browser");
      frame.setAttribute("type", "content");
      frame.setAttribute("disablehistory", "true");
      frame.style.visibility = "collapse";
      document.body.appendChild(frame);
    },
    teardown: function()
    {
      restoreFilterComponents.call(this);
      restorePrefs.call(this);

      stop();
      server.stop(function()
      {
        frame.parentElement.removeChild(frame);

        server = null;
        frame = null;
        start();
      });
    }
  });

  let tests = [
    [[], ["visible", "visible"]],
    [["#div(test1)"], ["hidden", "visible"]],
    [["localhost#div(test1)"], ["hidden", "visible"]],
    [["localhost#div(test1)", "foo,foo2#p(test2)"], ["hidden", "visible"]],
    [["localhost,foo#div(test1)", "foo,localhost#p(test2)"], ["hidden", "hidden"]],
    [["localhost#div(test1)", "localhost#p(test2)"], ["hidden", "hidden"]],
    [["foo#div(test1)", "foo#p(test2)"], ["visible", "visible"]],

    [["localhost#div(testClass)"], ["hidden", "visible"]],
    [["localhost#p(testClass)"], ["visible", "hidden"]],
    [["localhost#*(testClass)"], ["hidden", "hidden"]],
    [["localhost#div(testClass)", "localhost#p(test2)"], ["hidden", "hidden"]],
    [["localhost#p(testClass)", "localhost#p(test2)"], ["visible", "hidden"]],
    [["localhost#p(testClass)(test2)"], ["visible", "visible"]],   // this filter is invalid, must be ignored

    [["localhost#*(id^=test)"], ["hidden", "hidden"]],
    [["localhost#p(id^=test)"], ["visible", "hidden"]],
    [["localhost#*(id$=2)"], ["visible", "hidden"]],
    [["localhost#p(id$=2)"], ["visible", "hidden"]],
    [["localhost#div(id$=2)"], ["visible", "visible"]],

    [["localhost#*(test1)(id^=test)"], ["hidden", "visible"]],
    [["localhost#*(testClass)(id^=test)"], ["hidden", "hidden"]],
    [["localhost#p(testClass)(id^=test)"], ["visible", "hidden"]],
    [["localhost#*(test1)(id$=2)"], ["visible", "visible"]],
    [["localhost#*(testClass)(id$=2)"], ["visible", "hidden"]],
    [["localhost#p(testClass)(id$=2)"], ["visible", "hidden"]],

    [["localhost#*(test1)(id^=test)(id$=2)"], ["visible", "visible"]],
    [["localhost#*(test1)(id^=test)(id$=1)"], ["hidden", "visible"]],
    [["localhost#p(test1)(id^=test)(id$=1)"], ["visible", "visible"]],
    [["localhost#div(test1)(id^=test)(id$=1)"], ["hidden", "visible"]],
    [["localhost#*(id^=test)(id$=2)"], ["visible", "hidden"]],
    [["localhost#*(id^=test)(id$=1)"], ["hidden", "visible"]],
    [["localhost#p(id^=test)(id$=1)"], ["visible", "visible"]],
    [["localhost#div(id^=test)(id$=1)"], ["hidden", "visible"]],

    [["localhost##div#test1"], ["hidden", "visible"]],
    [["localhost##p.testClass"], ["visible", "hidden"]],
    [["localhost##div#test1, p.testClass"], ["hidden", "hidden"]],
    [["localhost##div#test1", "localhost##p.testClass"], ["hidden", "hidden"]],
    [["localhost##.testClass"], ["hidden", "hidden"]],

    [["~localhost##div#test1"], ["visible", "visible"]],
    [["foo,~localhost##div#test1"], ["visible", "visible"]],
    [["localhost,~foo##div#test1"], ["hidden", "visible"]],

    [["###test1", "localhost#@##test1"], ["visible", "visible"]],
    [["localhost###test1", "localhost#@##test1"], ["visible", "visible"]],
    [["localhost,~foo###test1", "localhost#@##test1"], ["visible", "visible"]],
    [["###test1", "foo#@##test1"], ["hidden", "visible"]],
    [["###test1", "~foo#@##test1"], ["visible", "visible"]],
    [["###test1", "~localhost#@##test1"], ["hidden", "visible"]],
    [["###test1", "#@##test1"], ["visible", "visible"]],
    [["localhost###test1", "#@##test1"], ["visible", "visible"]],

    [["localhost.###test1"], ["visible", "visible"]],
    [["localhost.,localhost###test1"], ["hidden", "visible"]],
    [["localhost.,foo.###test1"], ["visible", "visible"]],

    [["##div#test1", "@@localhost$generichide"], ["visible", "visible"]],
    [["##div#test1", "@@localhost$genericblock"], ["hidden", "visible"]],
    [["localhost##div#test1", "@@localhost$generichide"], ["hidden", "visible"]],
    [["~example.com##div#test1", "@@localhost$generichide"], ["visible", "visible"]],
    [["~example.com##div#test1", "@@localhost$genericblock"], ["hidden", "visible"]],
    [["~example.com,localhost##div#test1", "@@localhost$generichide"], ["hidden", "visible"]],
  ];

  function runTest([filters, expected], stage)
  {
    let listener = function(action)
    {
      if (action != "elemhideupdate")
        return;
      FilterNotifier.removeListener(listener);

      if (stage == 2)
        defaultMatcher.add(Filter.fromText("@@||localhost^$document"));
      else if (stage == 3)
        defaultMatcher.add(Filter.fromText("@@||localhost^$~document"));
      else if (stage == 4)
        defaultMatcher.add(Filter.fromText("@@||localhost^$elemhide"));

      if (stage == 2 || stage == 4)
        expected = ["visible", "visible"];   // Second and forth runs are whitelisted, nothing should be hidden

      frame.addEventListener("abp:frameready", function()
      {
        let frameScript = `
          // The "load" event doesn't mean XBL bindings are done, these will
          // take longer to load (async messaging). Only check visibility after
          // sending a message to parent and receiving response.
          addMessageListener("pong", function()
          {
            let visibility = [
              content.document.getElementById("test1").offsetHeight > 0 ? "visible" : "hidden",
              content.document.getElementById("test2").offsetHeight > 0 ? "visible" : "hidden"
            ];
            sendAsyncMessage("visibility", visibility);
          });
          sendAsyncMessage("ping");
        `;
        frame.messageManager.addMessageListener("ping", () => frame.messageManager.sendAsyncMessage("pong"));
        frame.messageManager.addMessageListener("visibility", (message) =>
        {
          let visibility = message.data;
          equal(visibility[0], expected[0], "First element visible");
          equal(visibility[1], expected[1], "Second element visible");

          start();
        });
        frame.messageManager.loadFrameScript("data:text/javascript," + encodeURIComponent(frameScript), false);
      }, false, true);
      frame.setAttribute("src", "http://localhost:1234/test");
    };
    FilterNotifier.addListener(listener);

    for (let filter_text of filters)
    {
      let filter = Filter.fromText(filter_text);
      if (filter instanceof WhitelistFilter)
        defaultMatcher.add(filter);
      else
        ElemHide.add(filter);
    }

    ElemHide.isDirty = true;
    ElemHide.apply();
  }

  let stageDescriptions = {
    1: "running without exceptions",
    2: "running with whitelisted document",
    3: "running with exception not applying to documents",
    4: "running with element hiding exception",
  };

  for (let test = 0; test < tests.length; test++)
  {
    let [filters, expected] = tests[test];
    for (let stage = 1; stage in stageDescriptions; stage++)
      asyncTest(filters.join(", ") + " (" + stageDescriptions[stage] + ")", runTest.bind(null, tests[test], stage));
  }
})();
