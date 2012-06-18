Cu.import("resource://gre/modules/Services.jsm");

let resHandler = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
resHandler.setSubstitution("mochikit", Services.io.newURI("chrome://mochikit/content/", null, null));
onShutdown.add(function()
{
  resHandler.setSubstitution("mochikit", null);
})
