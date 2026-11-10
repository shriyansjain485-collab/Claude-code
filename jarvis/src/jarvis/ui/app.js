// Jarvis browser window. Talks only to the Jarvis program on this computer.
// All text is inserted with textContent, never as HTML, so nothing Jarvis
// reads from a file can turn into code on this page.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var log = $("log"), input = $("input"), sendBtn = $("send"), stopBtn = $("stop");
  var state = { address: "sir", name: "Jarvis" };
  var busy = false;

  // The secret token arrives after "#" in the address, which browsers never
  // send over the network. Keep it for this tab and tidy the address bar.
  var token = "";
  var match = /token=([A-Za-z0-9_-]+)/.exec(location.hash);
  try {
    if (match) { token = match[1]; sessionStorage.setItem("jarvis-token", token); history.replaceState(null, "", "/"); }
    else { token = sessionStorage.getItem("jarvis-token") || ""; }
  } catch (e) { if (match) token = match[1]; }

  function api(path, body) {
    var options = { headers: { "X-Jarvis-Token": token } };
    if (body !== undefined) {
      options.method = "POST";
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    return fetch(path, options);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function add(node) {
    var nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    log.appendChild(node);
    if (nearBottom) log.scrollTop = log.scrollHeight;
    return node;
  }

  function setBusy(on) {
    busy = on;
    document.body.classList.toggle("busy", on);
    sendBtn.hidden = on; stopBtn.hidden = !on;
    input.disabled = false; sendBtn.disabled = false;
    $("status-line").textContent = on ? "Working…" : "Ready, " + state.address + ".";
    if (!on) input.focus();
  }

  function offline(message) {
    input.disabled = true; sendBtn.disabled = true;
    $("status-line").textContent = "Not connected";
    add(el("div", "msg error", message));
  }

  // ---- sidebar
  function renderState(data) {
    state = data;
    document.title = data.name;
    $("name").textContent = data.name;
    $("model").textContent = data.model;
    $("dry-run").checked = data.dry_run;
    showDryRun(data.dry_run);
    input.placeholder = "Ask " + data.name + "…";
    var tools = $("tools"); tools.textContent = "";
    data.tools.forEach(function (tool) {
      var item = el("li", "", tool.name.replace(/_/g, " "));
      item.title = tool.description;
      item.appendChild(el("span", "tag" + (tool.asks_first ? " asks" : ""), tool.asks_first ? "asks first" : "automatic"));
      if (tool.online) item.appendChild(el("span", "tag online", "breaks offline mode"));
      tools.appendChild(item);
    });
    var folders = $("folders"); folders.textContent = "";
    data.allowed_folders.forEach(function (folder) { folders.appendChild(el("li", "", folder)); });
  }

  function showDryRun(on) {
    var banner = $("banner");
    banner.hidden = !on;
    banner.textContent = on ? "DRY RUN: changes are shown but never made." : "";
  }

  function loadAudit() {
    api("/api/audit").then(function (r) { return r.json(); }).then(function (data) {
      var list = $("audit"); list.textContent = "";
      if (!data.entries.length) { list.appendChild(el("li", "", "Nothing yet.")); return; }
      data.entries.slice().reverse().forEach(function (entry) {
        var item = el("li");
        item.title = entry.time + "\n" + JSON.stringify(entry.inputs) + "\n" + (entry.result || "");
        item.appendChild(el("span", "outcome " + entry.outcome, entry.outcome.replace("_", " ")));
        item.appendChild(el("span", "", entry.tool + " · " + String(entry.time).slice(11, 16)));
        list.appendChild(item);
      });
    }).catch(function () {});
  }

  // ---- approvals
  function approvalCard(event) {
    var card = el("div", "approval");
    var header = el("header", "", "Approval needed");
    header.appendChild(el("small", "", event.tool));
    card.appendChild(header);
    card.appendChild(el("pre", "", event.preview));
    if (event.sources && event.sources.length) {
      card.appendChild(el("p", "sources",
        "Proposed after reading: " + event.sources.join(", ") +
        ". Check it is what you asked for, not something a file told me to do."));
    }
    var footer = el("footer");
    var yes = el("button", "primary", "Yes, apply"); yes.type = "button";
    var no = el("button", "", "Cancel"); no.type = "button";
    footer.appendChild(yes); footer.appendChild(no);
    footer.appendChild(el("span", "", "Nothing changes unless you choose Yes."));
    card.appendChild(footer);
    function answer(approve) {
      yes.disabled = true; no.disabled = true;
      api("/api/approve", { id: event.id, approve: approve });
    }
    yes.addEventListener("click", function () { answer(true); });
    no.addEventListener("click", function () { answer(false); });
    card.finish = function (approved) {
      card.classList.add("done");
      footer.textContent = "";
      footer.appendChild(el("span", "result " + (approved ? "yes" : "no"),
        approved ? "Applied." : "Cancelled. Nothing was changed."));
    };
    add(card);
    no.focus({ preventScroll: true });
    log.scrollTop = log.scrollHeight;
    return card;
  }

  // ---- one message
  function send(text) {
    add(el("div", "msg user", text));
    setBusy(true);
    var bubble = null, card = null, finished = false;

    function reply() {
      if (!bubble) bubble = add(el("div", "msg jarvis pending", ""));
      return bubble;
    }
    function closeBubble() { if (bubble) { bubble.classList.remove("pending"); bubble = null; } }

    function handle(event) {
      if (event.type === "text") { reply().textContent += event.text; log.scrollTop = log.scrollHeight; }
      else if (event.type === "notice") { closeBubble(); add(el("div", "msg notice", event.text)); }
      else if (event.type === "approval") { closeBubble(); card = approvalCard(event); }
      else if (event.type === "approval_result") { if (card) card.finish(event.approved); card = null; }
      else if (event.type === "done") {
        if (!bubble && event.text) reply().textContent = event.text;
        closeBubble(); finished = true;
      }
      else if (event.type === "stopped") { closeBubble(); add(el("div", "msg system", event.text)); finished = true; }
      else if (event.type === "error") { closeBubble(); add(el("div", "msg error", event.text)); finished = true; }
    }

    api("/api/message", { text: text }).then(function (response) {
      if (!response.ok || !response.body) {
        return response.json().then(function (data) { throw new Error(data.error || "request failed"); });
      }
      var reader = response.body.getReader(), decoder = new TextDecoder(), buffer = "";
      function pump() {
        return reader.read().then(function (chunk) {
          buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
          var lines = buffer.split("\n");
          buffer = lines.pop();
          lines.forEach(function (line) { if (line.trim()) handle(JSON.parse(line)); });
          if (!chunk.done) return pump();
        });
      }
      return pump();
    }).catch(function (error) {
      closeBubble();
      add(el("div", "msg error", "I lost contact with the Jarvis program (" + error.message + "). Is it still running in Terminal?"));
    }).then(function () {
      if (!finished) closeBubble();
      if (card) card.finish(false);
      setBusy(false);
      loadAudit();
    });
  }

  // ---- wiring
  $("composer").addEventListener("submit", function (event) {
    event.preventDefault();
    var text = input.value.trim();
    if (!text || busy) return;
    input.value = ""; input.style.height = "auto";
    send(text);
  });
  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      $("composer").requestSubmit();
    }
  });
  input.addEventListener("input", function () {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  });
  stopBtn.addEventListener("click", function () { api("/api/cancel", {}); });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && busy) api("/api/cancel", {});
  });
  $("dry-run").addEventListener("change", function (event) {
    api("/api/dry-run", { on: event.target.checked }).then(function (r) { return r.json(); })
      .then(function (data) { event.target.checked = data.dry_run; showDryRun(data.dry_run); });
  });
  $("refresh-audit").addEventListener("click", loadAudit);
  $("shutdown").addEventListener("click", function () {
    api("/api/shutdown", {}).catch(function () {}).then(function () {
      offline("Jarvis has shut down. Start it again with ./run.sh --ui in Terminal.");
      $("shutdown").disabled = true;
    });
  });

  if (!token) {
    offline("Open the full address printed in Terminal (it ends with #token=…). This page only works with that address.");
    return;
  }
  api("/api/state").then(function (response) {
    if (!response.ok) throw new Error("token");
    return response.json();
  }).then(function (data) {
    renderState(data);
    setBusy(false);
    add(el("div", "msg system", "At your service, " + data.address + ". Everything stays on this computer."));
    loadAudit();
  }).catch(function () {
    offline("That address has expired. Use the new one printed in Terminal when Jarvis started.");
  });
})();
