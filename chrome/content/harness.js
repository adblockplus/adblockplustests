// Some people actually switch off browser.frames.enabled and are surprised
// that things stop working...
window.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
      .getInterface(Components.interfaces.nsIWebNavigation)
      .QueryInterface(Components.interfaces.nsIDocShell)
      .allowSubframes = true;

window.addEventListener("load", startTests, false);

function startTests()
{
  document.getElementById("tests").setAttribute("src", "index.html" + location.search);
}
