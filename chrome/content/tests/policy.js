(function()
{
  let server = null;
  let frame = null;
  let requestNotifier = null;
  let httpProtocol = null;

  module("Content policy", {
    setup: function()
    {
      prepareFilterComponents.call(this);
      preparePrefs.call(this);

      server = new nsHttpServer();
      server.start(1234);

      frame = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "browser");
      frame.setAttribute("type", "content");
      frame.setAttribute("disablehistory", "true");
      frame.style.visibility = "collapse";
      document.body.appendChild(frame);

      requestNotifier = new RequestNotifier(frame.outerWindowID, onPolicyHit);

      httpProtocol = Utils.httpProtocol;
      Utils.httpProtocol = {userAgent: "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:30.0) Gecko/20100101 Firefox/30.0"};
    },
    teardown: function()
    {
      restoreFilterComponents.call(this);
      restorePrefs.call(this);

      stop();
      server.stop(function()
      {
        frame.parentElement.removeChild(frame);
        requestNotifier.shutdown();

        server = null;
        frame = null;
        requestNotifier = null;

        start();
      });

      Utils.httpProtocol = httpProtocol;
    }
  });

  /*
  -----BEGIN RSA PRIVATE KEY-----
  MIIBOQIBAAJBALZc50pEXnz9TSRozwM04rryuaXl/wgUFqV9FHq8HDlkdKvRU0hX
  hb/AKrSpCJ0NCxHtal1l/kHYlHG9e7Ev6+MCAwEAAQJBALRxYs5irhgAz2b6afOj
  TcFr0PRtipckwW/IPw5euZKyvswEJt/tWDv4OdmDnRe8FSy6FG2Got3zxvaxYdc3
  AXkCIQDfFGcytIVq3sbdF3lmhzcXf29R4Hrxg/eoByAKabxknwIhANFGSNMOGPt6
  JRajfB9XmsltQJzbkr2sfHgjMN2FLM49AiAH6tt2yz1o+5snQawHXYkxBk7XIxZ5
  9+sURZx3giUzlQIfXF+pxX9zh41i0ZtYLn181WxkGNjS7OY2CtF9wEoIfQIgcHuf
  shh1qrvuKiXnD9b72PF676laKdzxzX5rX6cZZLA=
  -----END RSA PRIVATE KEY-----
  */
  let publickey = "MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALZc50pEXnz9TSRozwM04rryuaXl/wgUFqV9FHq8HDlkdKvRU0hXhb/AKrSpCJ0NCxHtal1l/kHYlHG9e7Ev6+MCAwEAAQ";

  /**
   * Content:
   * /test\0127.0.0.1:1234\0Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:30.0) Gecko/20100101 Firefox/30.0
   */
  let adblockkey = "MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALZc50pEXnz9TSRozwM04rryuaXl/wgUFqV9FHq8HDlkdKvRU0hXhb/AKrSpCJ0NCxHtal1l/kHYlHG9e7Ev6+MCAwEAAQ==_gM4C/j8KkD2byPeP+THXk1GbLTUm5y+5jbdhcMtnzPMgImIfge0dGCtfU9cxLpe8BnqnEGNhTxpuu4pZxjOHYQ==";

  let dispatchReadyEvent = "document.dispatchEvent(new CustomEvent('abp:frameready', {bubbles: true}));";

  let tests = [
    [
      "HTML image with relative URL",
      '<img src="test.gif">',
      "http://127.0.0.1:1234/test.gif", "image", false, false
    ],
    [
      "HTML image with absolute URL",
      '<img src="http://localhost:1234/test.gif">',
      "http://localhost:1234/test.gif", "image", true, false
    ],
    [
      "HTML image button",
      '<input type="image" src="test.gif">',
      "http://127.0.0.1:1234/test.gif", "image", false, false
    ],
    [
      "HTML image button inside a frame",
      '<iframe src="data:text/html,%3Cinput%20type%3D%22image%22%20src%3D%22http%3A%2F%2F127.0.0.1:1234%2Ftest.gif%22%3E"></iframe>',
      "http://127.0.0.1:1234/test.gif", "image", false, false
    ],
    [
      "HTML image button inside a nested frame",
      '<iframe src="data:text/html,%3Ciframe%20src%3D%22data%3Atext%2Fhtml%2C%253Cinput%2520type%253D%2522image%2522%2520src%253D%2522http%253A%252F%252F127.0.0.1%3A1234%252Ftest.gif%2522%253E%22%3E%3C%2Fiframe%3E"></iframe>',
      "http://127.0.0.1:1234/test.gif", "image", false, false
    ],
    [
      "Dynamically inserted image button",
      '<div id="insert"></div>' +
      '<script>' +
        'window.addEventListener("DOMContentLoaded", function()' +
        '{' +
          'var div = document.getElementById("insert");' +
          'div.innerHTML = \'<input type="image" id="image" src="test.gif">\';' +
          'var image = document.getElementById("image");' +
          'image.onload = image.onerror = function ()' +
          '{' +
            dispatchReadyEvent +
          '};' +
        '}, false);' +
      '</script>',
      "http://127.0.0.1:1234/test.gif", "image", false, true
    ],
    [
      "CSS background-image",
      '<div style="background-image: url(test.gif)"></div>',
      "http://127.0.0.1:1234/test.gif", "image", false, false
    ],
    [
      "CSS cursor",
      '<div style="cursor: url(test.gif), pointer"></div>',
      "http://127.0.0.1:1234/test.gif", "image", false, false
    ],
    [
      "CSS list-style-image",
      '<ol>' +
        '<li style="list-style-image: url(test.gif)">foo</li>' +
      '</ol>',
      "http://127.0.0.1:1234/test.gif", "image", false, false
    ],
    [
      "CSS generated content",
      '<style>div:before { content: url(test.gif); }</style><div>foo</div>',
      "http://127.0.0.1:1234/test.gif", "image", false, false
    ],
    [
      "HTML embed (image)",
      '<embed type="image/gif" src="test.gif"></embed>',
      "http://127.0.0.1:1234/test.gif", "object", false, false
    ],
    [
      "HTML object (image)",
      '<object type="image/gif" data="test.gif"></object>',
      "http://127.0.0.1:1234/test.gif", "object", false, false
    ],
    [
      "SVG image",
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
        '<image xlink:href="test.gif"/>' +
      '</svg>',
      "http://127.0.0.1:1234/test.gif", "image", false, false
    ],
    [
      "SVG filter image",
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
        '<filter>' +
          '<feImage xlink:href="test.gif"/>' +
        '</filter>' +
      '</svg>',
      "http://127.0.0.1:1234/test.gif", "image", false, false
    ],
    [
      "HTML script",
      '<script src="test.js"></script>',
      "http://127.0.0.1:1234/test.js", "script", false, false
    ],
    [
      "SVG script",
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
        '<script xlink:href="test.js"/>' +
      '</svg>',
      "http://127.0.0.1:1234/test.js", "script", false, false
    ],
    [
      "HTML stylesheet",
      '<link rel="stylesheet" type="text/css" href="test.css">',
      "http://127.0.0.1:1234/test.css", "stylesheet", false, false
    ],
    [
      "HTML image with redirect",
      '<img src="redirect.gif">',
      "http://127.0.0.1:1234/test.gif", "image", false, false
    ],
    [
      "HTML image with multiple redirects",
      '<img src="redirect2.gif">',
      "http://127.0.0.1:1234/test.gif", "image", false, false
    ],
    [
      "CSS fonts",
      '<style type="text/css">@font-face { font-family: Test; src: url("test.otf"); } html { font-family: Test; }</style>',
      "http://127.0.0.1:1234/test.otf", "font", false, false
    ],
    [
      "XMLHttpRequest loading",
      '<script>' +
        'try' +
        '{' +
          'var request = new XMLHttpRequest();' +
          'request.open("GET", "test.xml", false);' +
          'request.send(null);' +
        '}' +
        'catch(e){}' +
      '</script>',
      "http://127.0.0.1:1234/test.xml", "xmlhttprequest", false, false
    ],
    [
      "XML document loading",
      '<script>' +
        'try' +
        '{' +
          'var xmlDoc = document.implementation.createDocument(null, "root", null);' +
          'xmlDoc.async = false;' +
          'xmlDoc.load("test.xml");' +
        '}' +
        'catch(e){}' +
      '</script>',
      "http://127.0.0.1:1234/test.xml", "xmlhttprequest", false, false
    ],
    [
      "Web worker",
      '<script>' +
        'try' +
        '{' +
          'var worker = new Worker("test.js");' +
          'worker.onerror = function(event)' +
          '{' +
            'event.preventDefault();' +
            dispatchReadyEvent +
          '};' +
        '}' +
        'catch (e)' +
        '{' +
          dispatchReadyEvent +
        '}' +
      '</script>',
      "http://127.0.0.1:1234/test.js", "script", false, true
    ],
    [
      "Beacon",
      '<script>' +
        'try' +
        '{' +
          'navigator.sendBeacon("test.cgi");' +
          'setTimeout(function() {' + dispatchReadyEvent + '}, 500)' +
        '}' +
        'catch (e)' +
        '{' +
          dispatchReadyEvent +
        '}' +
      '</script>',
      "http://127.0.0.1:1234/test.cgi", "ping", false, true
    ],
  ];

  if (window.navigator.mimeTypes["application/x-shockwave-flash"] && window.navigator.mimeTypes["application/x-shockwave-flash"].enabledPlugin)
  {
    tests.push([
      "HTML embed (Flash)",
      '<embed type="application/x-shockwave-flash" src="test.swf"></embed>' +
        '<script>var r = new XMLHttpRequest();r.open("GET", "", false);r.send(null);</script>',
      "http://127.0.0.1:1234/test.swf", "object", false, false
    ],
    [
      "HTML object (Flash)",
      '<object type="application/x-shockwave-flash" data="test.swf"></object>' +
        '<script>var r = new XMLHttpRequest();r.open("GET", "", false);r.send(null);</script>',
      "http://127.0.0.1:1234/test.swf", "object", false, false
    ]);
  }

  if (window.navigator.mimeTypes["application/x-java-applet"] && window.navigator.mimeTypes["application/x-java-applet"].enabledPlugin)
  {
    // Note: this could use some improvement but Gecko will fail badly with more complicated tests (bug 364400)
    // Note: <applet> is not on the list because it shows some weird async behavior (data is loaded after page load in some strange way)
    tests.push([
      "HTML embed (Java)",
      '<embed type="application/x-java-applet" code="test.class" src="test.class"></embed>',
      "http://127.0.0.1:1234/test.class", "object", false, false
    ],
    [
      "HTML object (Java)",
      '<object type="application/x-java-applet" data="test.class"></object>',
      "http://127.0.0.1:1234/test.class", "object", false, false
    ]);
  }

  let policyHits = [];
  function onPolicyHit(item, scanComplete)
  {
    if (!item)
      return;
    if (item.location == "http://127.0.0.1:1234/test" ||
        item.location == "http://127.0.0.1:1234/redirect.gif" ||
        item.location == "http://127.0.0.1:1234/redirect2.gif")
    {
      return;
    }
    if (item.filter && item.filter.substr(0, 2) == "@@")
      return;

    if (policyHits.length > 0)
    {
      // Ignore duplicate policy calls (possible due to prefetching)
      let prevItem = policyHits[policyHits.length - 1];
      if (prevItem.location == item.location && prevItem.type == item.type && prevItem.docDomain == item.docDomain)
        policyHits.pop();
    }
    policyHits.push(item);
  }

  function runTest([name, body, expectedURL, expectedType, expectedThirdParty, explicitEvent], stage)
  {
    defaultMatcher.clear();

    if (stage == 7)
      defaultMatcher.add(Filter.fromText(expectedURL + "$domain=127.0.0.1"));
    else if (stage > 1)
      defaultMatcher.add(Filter.fromText(expectedURL));

    if (stage == 3)
      defaultMatcher.add(Filter.fromText("@@||127.0.0.1:1234/test|$document"));
    if (stage == 4)
      defaultMatcher.add(Filter.fromText("@@||127.0.0.1:1234/test|$~document"));
    if (stage == 5)
      defaultMatcher.add(Filter.fromText("@@||127.0.0.1:1234/test|$document,sitekey=" + publickey));
    if (stage == 6 || stage == 7)
      defaultMatcher.add(Filter.fromText("@@||127.0.0.1:1234/test|$genericblock"));
    if (stage == 8)
      defaultMatcher.add(Filter.fromText("@@||127.0.0.1:1234/test|$genericblock,sitekey=" + publickey));

    if (!explicitEvent)
    {
      if (body.indexOf("2000/svg") >= 0)
      {
        // SVG image: add an onload attribute to the document element and keep
        // polling until the document is really loaded.
        body = body.replace(/(<svg\b)/, '$1 onload="if (document.readyState != \'complete\') setTimeout(arguments.callee.bind(this), 0); else ' + dispatchReadyEvent + '"');
      }
      else
      {
        // HTML data: wrap it into a <body> tag
        body = '<body onload="' + dispatchReadyEvent + '">' + body + '</body>';
      }
    }

    let serverHit = false;
    server.registerPathHandler("/test", function(metadata, response)
    {
      response.setStatusLine("1.1", "200", "OK");

      let contentType = "text/html";
      if (body.indexOf("2000/svg") >= 0)
      {
        contentType = "image/svg+xml";
        body = body.replace(/^<svg/, "<svg data-adblockkey='" + adblockkey + "'");
      }
      else
        body = "<html data-adblockkey='" + adblockkey + "'>" + body + "</html>";
      response.setHeader("Content-Type", contentType + "; charset=utf-8");

      response.bodyOutputStream.write(body, body.length);
    });
    server.registerPathHandler("/redirect.gif", function(metadata, response)
    {
      response.setStatusLine("1.1", "302", "Moved Temporarily");
      response.setHeader("Location", "http://127.0.0.1:1234/test.gif");
    });
    server.registerPathHandler("/redirect2.gif", function(metadata, response)
    {
      response.setStatusLine("1.1", "302", "Moved Temporarily");
      response.setHeader("Location", "http://127.0.0.1:1234/redirect.gif");
    });
    server.registerPathHandler(expectedURL.replace(/http:\/\/[^\/]+/, ""), function(metadata, response)
    {
      serverHit = true;
      response.setStatusLine("1.1", "404", "Not Found");
      response.setHeader("Content-Type", "text/html");

      // Work around weird Firefox behavior, where worker scripts succesfully load with empty 404 pages.
      var error = "<b>Not found...<b>";
      response.bodyOutputStream.write(error, error.length);
    });

    policyHits = [];
    let callback = function()
    {
      frame.messageManager.removeMessageListener("ready", callback);

      let expectedStatus = "allowed";
      if (stage == 3)
        equal(policyHits.length, 0, "Number of policy hits");
      // We cannot rely on the correctness of policy hits for sitekey filters due to blocking
      // filter hits being counted even if the resource doesn't end up getting blocked
      else if (stage != 5 && stage != 6 && stage != 8)
      {
        equal(policyHits.length, 1, "Number of policy hits");
        if (policyHits.length == 1)
        {
          let item = policyHits[0];

          equal(item.location, expectedURL, "Request URL");

          expectedStatus = (stage == 1 ? "allowed" : "blocked");
          let actualStatus = (item.filter ? "blocked" : "allowed");

          equal(actualStatus, expectedStatus, "Request blocked");
          equal(item.type.toLowerCase(), expectedType, "Request type");
          equal(item.thirdParty, expectedThirdParty, "Third-party flag");
          equal(item.docDomain, "127.0.0.1", "Document domain");
        }
      }
      server.registerPathHandler(expectedURL.replace(/http:\/\/[^\/]+/, ""), null);
      equal(serverHit, expectedStatus == "allowed", "Request received by server");

      start();
    };
    let callback2 = function()
    {
      // The frame will report hits asynchronously so make the frame send us a
      // message and only process the results after it is received.
      frame.removeEventListener("abp:frameready", callback2, false);
      frame.messageManager.addMessageListener("ready", callback);
      frame.messageManager.loadFrameScript("data:text/javascript,sendAsyncMessage('ready')", false);
    };
    frame.addEventListener("abp:frameready", callback2, false, true);
    frame.setAttribute("src", "http://127.0.0.1:1234/test");
  }

  let stageDescriptions = {
    1: "running without filters",
    2: "running with filter %S",
    3: "running with filter %S and site exception",
    4: "running with filter %S and exception not applicable to sites",
    5: "running with filter %S and sitekey exception",
    6: "running with filter %S and $genericblock exception",
    7: "running with filter %S$domain=127.0.0.1 and $genericblock exception",
    8: "running with filter %S and $genericblock,sitekey exception"
  };

  for (let test = 0; test < tests.length; test++)
  {
    let [name, body, expectedURL, expectedType, expectedDomain, expectedThirdParty] = tests[test];
    for (let stage = 1; stage in stageDescriptions; stage++)
    {
      let stageDescription = stageDescriptions[stage];
      if (stageDescription.indexOf("%S") >= 0)
        stageDescription = stageDescription.replace("%S", expectedURL);

      asyncTest(name + " (" + stageDescription + ")", runTest.bind(null, tests[test], stage));
    }
  }
})();
