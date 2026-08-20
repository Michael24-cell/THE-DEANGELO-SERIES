/* ============================================================================
   THE DEANGELO SERIES — site-ui.js
   Self-contained interaction layer shared across all pages.
   Adds, without touching the existing visual language:
     • Hamburger menu drawer  (slides from left, black gallery-index panel)
     • Cart slide-out drawer  (slides from right, bone plate-card panel)
     • Size guide modal       (centered bone card, flat measurement table)
     • Accordion engine        ([data-acc] groups on the product page)
     • Persistent cart state   (localStorage; count mirrored into nav)
   Pure vanilla JS. No dependencies. Square edges, hairlines, Cormorant/Inter.
   ========================================================================== */
(function () {
  "use strict";

  /* ---- tokens (kept local so the file is portable) ---------------------- */
  var T = {
    black: "#0A0A0A",
    bone: "#F5F5F1",
    boneTint: "#ECECE6",
    boneWarm: "#EFEDE5",
    boneDeep: "#E5E4DD",
    white: "#FFFFFF",
    hlDark: "rgba(10,10,10,.14)",
    hlSoft: "rgba(10,10,10,.07)",
    hlLight: "rgba(255,255,255,.12)",
    inkDim: "rgba(10,10,10,.55)",
    inkMute: "rgba(10,10,10,.42)",
    paperDim: "rgba(255,255,255,.5)",
    serif: "'Cormorant Garamond',serif",
    sans: "'Inter',sans-serif"
  };

  /* ---- menu information architecture (expandable dropdown groups) ------- */
  var MENU_GROUPS = [
    { label: "Shop", items: [
      { label: "Shop Series 01", href: "collection.html" },
      { label: "The Archive", href: "archive.html" }
    ]},
    { label: "The Source", items: [
      { label: "The Artwork", href: "art.html" },
      { label: "Statement", href: "statement.html" },
      { label: "The Artist", href: "artist.html" }
    ]},
    { label: "Information", items: [
      { label: "Shipping", href: "shipping-policy.html" },
      { label: "Returns", href: "refund-policy.html" },
      { label: "Size Guide", href: "#", sizeGuide: true },
      { label: "Contact", href: "contact.html" }
    ]}
  ];
  var MENU_DIRECT = [];

  /* ---- size guide data (flat measures / in), per garment ----------------
     Mirrors the real per-product tables on product.html (#sgTee/#sgCrew) \u2014
     same source numbers, not a separate/placeholder set. Hoodie has no
     confirmed measurements yet, matching product.html's "coming soon". */
  var SIZE_GUIDES = {
    tee: {
      label: "Tee",
      sizes: ["S", "M", "L", "XL", "2XL"],
      rows: [
        ["Length", ["22.75", "24.75", "26.50", "28.00", "30.00"]],
        ["Width", ["26.75", "27.25", "29.25", "31.25", "31.25"]],
        ["Sleeve length", ["10.25", "10.50", "11.50", "11.50", "11.75"]]
      ],
      tolerance: "1\""
    },
    crew: {
      label: "Crewneck",
      sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
      rows: [
        ["Width", ["21.00", "23.00", "25.00", "26.50", "28.00", "29.50"]],
        ["Length", ["27.50", "28.50", "29.50", "30.50", "31.50", "32.50"]],
        ["Sleeve from center back", ["31.50", "33.50", "35.25", "36.75", "38.25", "39.25"]]
      ],
      tolerance: "1.5\""
    },
    hoodie: {
      label: "Hoodie",
      comingSoon: true
    }
  };
  var SIZE_GUIDE_ORDER = ["tee", "crew", "hoodie"];

  /* ---- swatch backgrounds (reuse the site's hatch placeholder look) ------ */
  function swatchBg(kind) {
    switch (kind) {
      case "artwork":
        return "repeating-linear-gradient(45deg,transparent 0 13px,rgba(10,10,10,.06) 13px 14px)," + T.boneWarm;
      case "detail":
        return "repeating-linear-gradient(90deg,transparent 0 11px,rgba(10,10,10,.05) 11px 12px)," + T.boneWarm;
      default:
        return "repeating-linear-gradient(135deg,transparent 0 8px,rgba(10,10,10,.04) 8px 9px)," + T.boneTint;
    }
  }

  /* ======================================================================
     STYLES
     ====================================================================== */
  var CSS = [
    /* scrim shared by every overlay */
    ".du-scrim{position:fixed;inset:0;background:rgba(10,10,10,.42);opacity:0;visibility:hidden;",
    "transition:opacity .45s ease,visibility .45s ease;z-index:2000}",
    ".du-scrim.is-open{opacity:1;visibility:visible}",
    "html.du-lock,body.du-lock{overflow:hidden}",

    /* hamburger trigger — inherits nav color via currentColor */
    ".du-ham{display:inline-flex;align-items:center;gap:11px;background:none;border:0;color:inherit;",
    "font:inherit;text-transform:uppercase;letter-spacing:.2em;font-size:11px;font-weight:500;",
    "cursor:pointer;padding:0;line-height:1;transition:opacity .25s ease}",
    ".du-ham:hover{opacity:.55}",
    ".du-ham .du-ham-ico{display:inline-flex;flex-direction:column;gap:4px;width:20px}",
    ".du-ham .du-ham-ico i{display:block;height:1px;background:currentColor;width:100%}",
    ".du-ham .du-ham-ico i:last-child{width:13px}",

    /* ---- generic side panel ---- */
    ".du-panel{position:fixed;top:0;bottom:0;z-index:2001;display:flex;flex-direction:column;",
    "transition:transform .48s cubic-bezier(.22,.61,.36,1);will-change:transform}",

    /* MENU — left, black gallery panel */
    ".du-menu{left:0;width:min(430px,92vw);background:" + T.black + ";color:" + T.bone + ";",
    "transform:translateX(-100%)}",
    ".du-menu.is-open{transform:none}",
    ".du-menu .du-panel-head{display:flex;align-items:center;justify-content:space-between;",
    "padding:26px 40px;border-bottom:1px solid " + T.hlLight + "}",
    ".du-menu .du-eyebrow{font-family:" + T.sans + ";font-size:10px;letter-spacing:.4em;",
    "text-transform:uppercase;color:" + T.paperDim + "}",
    ".du-menu .du-mnav{flex:1;overflow-y:auto;padding:6px 40px 20px}",

    /* expandable group */
    ".du-mgroup{border-bottom:1px solid " + T.hlLight + "}",
    ".du-mgroup-head{width:100%;background:none;border:0;color:inherit;font:inherit;cursor:pointer;",
    "display:flex;align-items:center;justify-content:space-between;gap:20px;padding:21px 0;text-align:left}",
    ".du-mgroup-label{font-family:" + T.serif + ";font-weight:500;font-size:1.85rem;line-height:1;",
    "letter-spacing:-.01em;color:" + T.bone + ";transition:opacity .25s ease}",
    ".du-mgroup-head:hover .du-mgroup-label{opacity:.55}",
    ".du-msign{position:relative;width:12px;height:12px;flex:none;opacity:.65}",
    ".du-msign::before,.du-msign::after{content:'';position:absolute;background:currentColor;",
    "left:0;top:5.5px;width:12px;height:1px;transition:transform .35s ease,opacity .35s ease}",
    ".du-msign::after{transform:rotate(90deg)}",
    ".du-mgroup.is-open .du-msign::after{transform:rotate(0);opacity:0}",
    ".du-msub-panel{overflow:hidden;height:0;transition:height .4s cubic-bezier(.22,.61,.36,1)}",
    ".du-msub-inner{display:flex;flex-direction:column;padding:0 0 18px}",
    ".du-msub{font-family:" + T.sans + ";font-size:11px;font-weight:400;letter-spacing:.22em;",
    "text-transform:uppercase;color:" + T.paperDim + ";text-decoration:none;padding:9px 0;",
    "transition:color .22s ease}",
    ".du-msub:hover{color:" + T.bone + "}",

    /* direct (childless) links */
    ".du-mdirect-wrap{padding-top:2px}",
    ".du-mdirect{display:block;font-family:" + T.serif + ";font-weight:500;font-size:1.85rem;line-height:1;",
    "letter-spacing:-.01em;color:" + T.bone + ";text-decoration:none;padding:21px 0;",
    "border-bottom:1px solid " + T.hlLight + ";transition:opacity .25s ease}",
    ".du-mdirect:last-child{border-bottom:0}",
    ".du-mdirect:hover{opacity:.55}",

    ".du-menu .du-foot{padding:22px 40px;border-top:1px solid " + T.hlLight + ";display:flex;gap:28px;",
    "font-family:" + T.sans + ";font-size:10px;letter-spacing:.3em;text-transform:uppercase;color:" + T.paperDim + "}",
    ".du-menu .du-foot a{color:inherit;text-decoration:none;transition:color .22s ease}",
    ".du-menu .du-foot a:hover{color:" + T.bone + "}",
    ".du-menu .du-foot .loc{margin-left:auto;letter-spacing:.25em}",

    /* CART — right, bone plate-card panel */
    ".du-cart{right:0;width:min(460px,94vw);background:" + T.bone + ";color:" + T.black + ";",
    "transform:translateX(100%)}",
    ".du-cart.is-open{transform:none}",
    ".du-cart .du-panel-head{display:flex;align-items:center;justify-content:space-between;",
    "padding:30px 36px;border-bottom:1px solid " + T.hlDark + "}",
    ".du-cart .du-cart-title{display:flex;align-items:baseline;gap:14px}",
    ".du-cart .du-cart-title h2{font-family:" + T.serif + ";font-weight:500;font-size:1.7rem;letter-spacing:-.01em}",
    ".du-cart .du-cart-title span{font-family:" + T.sans + ";font-size:10px;letter-spacing:.3em;",
    "text-transform:uppercase;color:" + T.inkMute + "}",
    ".du-cart .du-cart-body{flex:1;overflow-y:auto;padding:8px 36px}",
    ".du-citem{display:grid;grid-template-columns:72px 1fr auto;gap:20px;padding:26px 0;",
    "border-bottom:1px solid " + T.hlSoft + "}",
    ".du-citem-img{aspect-ratio:4/5;width:72px;background:" + T.boneTint + "}",
    ".du-citem-main{display:flex;flex-direction:column;gap:7px;min-width:0}",
    ".du-citem-line{display:flex;align-items:baseline;gap:8px;font-family:" + T.sans + ";font-size:11px;",
    "font-weight:500;letter-spacing:.22em;text-transform:uppercase}",
    ".du-citem-line .sep{opacity:.35;font-weight:300}",
    ".du-citem-name{font-family:" + T.serif + ";font-weight:500;font-size:1.25rem;line-height:1.05;letter-spacing:-.01em}",
    ".du-citem-size{font-family:" + T.sans + ";font-size:10px;letter-spacing:.25em;text-transform:uppercase;color:" + T.inkMute + "}",
    ".du-qty{display:inline-flex;align-items:center;gap:0;border:1px solid " + T.hlDark + ";margin-top:6px;width:max-content}",
    ".du-qty button{width:28px;height:26px;background:none;border:0;color:inherit;font:inherit;font-size:13px;",
    "cursor:pointer;line-height:1;transition:background .2s ease}",
    ".du-qty button:hover{background:" + T.boneDeep + "}",
    ".du-qty span{min-width:28px;text-align:center;font-family:" + T.sans + ";font-size:11px;letter-spacing:.1em;",
    "border-left:1px solid " + T.hlDark + ";border-right:1px solid " + T.hlDark + ";line-height:26px}",
    ".du-citem-right{display:flex;flex-direction:column;align-items:flex-end;justify-content:space-between}",
    ".du-citem-price{font-family:" + T.sans + ";font-weight:300;font-size:1rem}",
    ".du-citem-rm{background:none;border:0;color:" + T.inkMute + ";font:inherit;font-size:10px;letter-spacing:.2em;",
    "text-transform:uppercase;cursor:pointer;padding:0;transition:color .2s ease}",
    ".du-citem-rm:hover{color:" + T.black + "}",
    /* empty state */
    ".du-cart-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;",
    "text-align:center;padding:60px 36px;color:" + T.inkMute + "}",
    ".du-cart-empty p{font-family:" + T.serif + ";font-style:italic;font-weight:300;font-size:1.5rem;color:" + T.black + "}",
    ".du-cart-empty a{font-family:" + T.sans + ";font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:" + T.black + ";",
    "text-decoration:none;border-bottom:1px solid " + T.hlDark + ";padding-bottom:3px}",
    /* footer */
    ".du-cart-foot{border-top:1px solid " + T.hlDark + ";padding:26px 36px 30px}",
    ".du-cart-sub{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px}",
    ".du-cart-sub .lbl{font-family:" + T.sans + ";font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:" + T.inkMute + "}",
    ".du-cart-sub .val{font-family:" + T.sans + ";font-weight:300;font-size:1.3rem}",
    ".du-cart-note{font-family:" + T.sans + ";font-size:10.5px;font-weight:300;color:" + T.inkMute + ";margin-bottom:20px;letter-spacing:.04em}",
    ".du-cart-checkout{display:block;width:100%;background:" + T.black + ";color:" + T.bone + ";border:1px solid " + T.black + ";",
    "padding:20px;text-align:center;font-family:" + T.sans + ";font-size:11px;letter-spacing:.35em;text-transform:uppercase;",
    "text-decoration:none;cursor:pointer;transition:background .2s ease,color .2s ease}",
    ".du-cart-checkout:hover{background:transparent;color:" + T.black + "}",
    ".du-cart-cont{display:block;width:100%;text-align:center;margin-top:13px;background:none;border:0;color:" + T.inkMute + ";",
    "font-family:" + T.sans + ";font-size:10px;letter-spacing:.3em;text-transform:uppercase;cursor:pointer;padding:4px}",
    ".du-cart-cont:hover{color:" + T.black + "}",

    /* shared close button */
    ".du-x{background:none;border:0;color:inherit;font:inherit;cursor:pointer;padding:0;line-height:1;",
    "font-size:10px;letter-spacing:.25em;text-transform:uppercase;display:inline-flex;align-items:center;gap:8px;",
    "transition:opacity .25s ease}",
    ".du-x:hover{opacity:.55}",
    ".du-x .gl{font-size:15px;letter-spacing:0;transform:translateY(-.5px)}",

    /* ---- SIZE GUIDE modal ---- */
    ".du-modal{position:fixed;inset:0;z-index:2100;display:flex;align-items:center;justify-content:center;",
    "padding:24px;opacity:0;visibility:hidden;transition:opacity .35s ease,visibility .35s ease}",
    ".du-modal.is-open{opacity:1;visibility:visible}",
    ".du-modal-card{position:relative;width:min(560px,100%);max-height:88vh;overflow-y:auto;background:" + T.bone + ";",
    "color:" + T.black + ";border:1px solid " + T.hlDark + ";padding:44px 48px 48px;",
    "transform:translateY(12px);transition:transform .4s cubic-bezier(.22,.61,.36,1)}",
    ".du-modal.is-open .du-modal-card{transform:none}",
    ".du-modal-head{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px}",
    ".du-modal-eyebrow{font-family:" + T.sans + ";font-size:10px;letter-spacing:.4em;text-transform:uppercase;color:" + T.inkMute + "}",
    ".du-modal h2{font-family:" + T.serif + ";font-weight:500;font-size:2.2rem;letter-spacing:-.01em;margin:10px 0 6px}",
    ".du-modal-intro{font-family:" + T.sans + ";font-weight:300;font-size:.92rem;line-height:1.6;color:" + T.inkDim + ";",
    "max-width:46ch;margin-bottom:22px}",
    ".du-sg-tabs{display:flex;gap:22px;border-bottom:1px solid " + T.hlDark + ";margin-bottom:24px}",
    ".du-sg-tab{background:none;border:0;color:inherit;font:inherit;cursor:pointer;padding:0 0 12px;",
    "font-family:" + T.sans + ";font-size:11px;font-weight:500;letter-spacing:.25em;text-transform:uppercase;",
    "color:" + T.inkMute + ";position:relative}",
    ".du-sg-tab:hover{color:" + T.black + "}",
    ".du-sg-tab.is-active{color:" + T.black + "}",
    ".du-sg-tab.is-active::after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:1px;background:" + T.black + "}",
    ".du-sg-panel{display:none}",
    ".du-sg-panel.is-active{display:block}",
    ".du-sg-soon{font-family:" + T.sans + ";font-weight:300;font-size:.9rem;color:" + T.inkDim + ";margin-bottom:28px}",
    ".du-table{width:100%;border-collapse:collapse;margin-bottom:28px}",
    ".du-table th{font-family:" + T.sans + ";font-size:10px;font-weight:500;letter-spacing:.22em;text-transform:uppercase;",
    "color:" + T.inkMute + ";text-align:right;padding:0 0 14px;border-bottom:1px solid " + T.hlDark + "}",
    ".du-table th:first-child{text-align:left}",
    ".du-table td{font-family:" + T.sans + ";font-weight:300;font-size:.95rem;text-align:right;padding:14px 0;",
    "border-bottom:1px solid " + T.hlSoft + ";font-variant-numeric:tabular-nums}",
    ".du-table td:first-child{text-align:left;font-weight:500;letter-spacing:.18em;text-transform:uppercase;font-size:11px}",
    ".du-table tr:last-child td{border-bottom:0}",
    ".du-measure{font-family:" + T.sans + ";font-size:11px;font-weight:500;letter-spacing:.25em;text-transform:uppercase;",
    "color:" + T.inkMute + ";margin-bottom:12px}",
    ".du-measure-list{list-style:none;display:flex;flex-direction:column;gap:9px;margin:0;padding:0}",
    ".du-measure-list li{font-family:" + T.sans + ";font-weight:300;font-size:.9rem;line-height:1.5;color:" + T.inkDim + ";",
    "padding-left:22px;position:relative}",
    ".du-measure-list li::before{content:'';position:absolute;left:0;top:.62em;width:13px;height:1px;background:" + T.black + ";opacity:.4}",
    ".du-measure-list strong{font-weight:500;color:" + T.black + "}",

    /* ---- ACCORDION (product page) ---- */
    ".du-acc{border-top:1px solid " + T.hlSoft + "}",
    ".du-acc-item{border-bottom:1px solid " + T.hlSoft + "}",
    ".du-acc-trigger{width:100%;background:none;border:0;color:inherit;font:inherit;cursor:pointer;",
    "display:flex;align-items:center;justify-content:space-between;gap:20px;padding:24px 0;text-align:left}",
    ".du-acc-trigger .du-acc-label{font-family:" + T.sans + ";font-size:11px;font-weight:500;letter-spacing:.3em;text-transform:uppercase}",
    ".du-acc-trigger .du-acc-sign{position:relative;width:11px;height:11px;flex:none}",
    ".du-acc-trigger .du-acc-sign::before,.du-acc-trigger .du-acc-sign::after{content:'';position:absolute;background:currentColor;",
    "left:0;top:5px;width:11px;height:1px;transition:transform .35s ease,opacity .35s ease}",
    ".du-acc-trigger .du-acc-sign::after{transform:rotate(90deg)}",
    ".du-acc-item.is-open .du-acc-sign::after{transform:rotate(0);opacity:0}",
    ".du-acc-panel{overflow:hidden;height:0;transition:height .4s cubic-bezier(.22,.61,.36,1)}",
    ".du-acc-inner{padding:0 0 28px}",

    /* responsive */
    "@media (max-width:640px){",
    /* keep the hamburger visible on mobile even where the page hides .nav-links */
    ".nav-links{display:flex !important;gap:0 !important}",
    ".nav-links>a{display:none !important}",
    ".du-ham{display:inline-flex !important}",
    ".du-menu .du-panel-head{padding:24px 26px}",
    ".du-menu nav{padding:30px 26px}",
    ".du-mlink{font-size:1.8rem}",
    ".du-menu .du-foot{padding:22px 26px}",
    ".du-cart .du-panel-head,.du-cart .du-cart-body,.du-cart-foot{padding-left:24px;padding-right:24px}",
    ".du-modal-card{padding:32px 26px 36px}",
    ".du-modal h2{font-size:1.8rem}",
    "}"
  ].join("");

  /* ======================================================================
     CART STORE
     ====================================================================== */
  var STORE_KEY = "deangelo_cart";
  function loadCart() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveCart(c) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(c)); } catch (e) {}
  }
  var cart = loadCart();

  function cartCount() {
    return cart.reduce(function (n, it) { return n + it.qty; }, 0);
  }
  function cartSubtotal() {
    return cart.reduce(function (n, it) { return n + it.price * it.qty; }, 0);
  }
  function keyOf(it) { return (it.slug || it.plate) + "|" + it.size + "|" + (it.color || ""); }

  function addToCart(item) {
    var hit = null;
    for (var i = 0; i < cart.length; i++) {
      if (keyOf(cart[i]) === keyOf(item)) { hit = cart[i]; break; }
    }
    if (hit) hit.qty += item.qty || 1;
    else cart.push({
      slug: item.slug || "", plate: item.plate, name: item.name, size: item.size, color: item.color || "",
      price: item.price, kind: item.kind || "model", img: item.img || "", qty: item.qty || 1
    });
    saveCart(cart);
    renderCart();
    syncCount();
  }
  function setQty(idx, delta) {
    if (!cart[idx]) return;
    cart[idx].qty += delta;
    if (cart[idx].qty <= 0) cart.splice(idx, 1);
    saveCart(cart);
    renderCart();
    syncCount();
  }
  function removeItem(idx) {
    cart.splice(idx, 1);
    saveCart(cart);
    renderCart();
    syncCount();
  }

  /* ======================================================================
     DOM BUILD
     ====================================================================== */
  var els = {};

  function buildMenu() {
    var groups = MENU_GROUPS.map(function (g, gi) {
      var subs = g.items.map(function (it) {
        var attr = it.sizeGuide ? " data-size-guide" : "";
        return '<a class="du-msub" href="' + it.href + '"' + attr + ">" + it.label + "</a>";
      }).join("");
      var openCls = gi === 0 ? " is-open" : "";
      return '<div class="du-mgroup' + openCls + '">' +
        '<button class="du-mgroup-head" aria-expanded="' + (gi === 0) + '">' +
          '<span class="du-mgroup-label">' + g.label + "</span>" +
          '<span class="du-msign"></span>' +
        "</button>" +
        '<div class="du-msub-panel"><div class="du-msub-inner">' + subs + "</div></div>" +
      "</div>";
    }).join("");

    var direct = MENU_DIRECT.map(function (m) {
      return '<a class="du-mdirect" href="' + m.href + '">' + m.label + "</a>";
    }).join("");

    var menu = document.createElement("aside");
    menu.className = "du-panel du-menu";
    menu.setAttribute("aria-hidden", "true");
    menu.innerHTML =
      '<div class="du-panel-head">' +
        '<span class="du-eyebrow">Menu</span>' +
        '<button class="du-x" data-menu-close><span class="gl">\u2715</span>Close</button>' +
      "</div>" +
      "<div class=\"du-mnav\">" + groups + '<div class="du-mdirect-wrap">' + direct + "</div></div>" +
      '<div class="du-foot">' +
        '<a href="contact.html">Contact</a>' +
        '<a href="mailto:support@thedeangeloseries.com">Support</a>' +
        '<span class="loc">California</span>' +
      "</div>";
    return menu;
  }

  function toggleMenuGroup(group) {
    var panel = group.querySelector(".du-msub-panel");
    var head = group.querySelector(".du-mgroup-head");
    if (group.classList.contains("is-open")) {
      panel.style.height = panel.scrollHeight + "px";
      requestAnimationFrame(function () { panel.style.height = "0px"; });
      group.classList.remove("is-open");
      head.setAttribute("aria-expanded", "false");
    } else {
      group.classList.add("is-open");
      panel.style.height = panel.scrollHeight + "px";
      panel.addEventListener("transitionend", function te() {
        panel.style.height = "auto";
        panel.removeEventListener("transitionend", te);
      });
      head.setAttribute("aria-expanded", "true");
    }
  }

  function buildCart() {
    var cartEl = document.createElement("aside");
    cartEl.className = "du-panel du-cart";
    cartEl.setAttribute("aria-hidden", "true");
    cartEl.innerHTML =
      '<div class="du-panel-head">' +
        '<div class="du-cart-title"><h2>Cart</h2><span data-cart-headcount></span></div>' +
        '<button class="du-x" data-cart-close><span class="gl">\u2715</span>Close</button>' +
      "</div>" +
      '<div class="du-cart-body" data-cart-body></div>' +
      '<div class="du-cart-foot" data-cart-foot></div>';
    return cartEl;
  }

  function sizeGuidePanelHtml(key) {
    var g = SIZE_GUIDES[key];
    if (g.comingSoon) {
      return '<div class="du-sg-panel" data-sg-panel="' + key + '">' +
        '<p class="du-sg-soon">' + g.label + ' size chart coming soon.</p>' +
      "</div>";
    }
    var head = "<tr><th></th>" + g.sizes.map(function (s) { return "<th>" + s + "</th>"; }).join("") + "</tr>";
    var body = g.rows.map(function (row) {
      var cells = row[1].map(function (v) { return "<td>" + v + '"</td>'; }).join("");
      return "<tr><td>" + row[0] + "</td>" + cells + "</tr>";
    }).join("");
    return '<div class="du-sg-panel" data-sg-panel="' + key + '">' +
      '<table class="du-table"><thead>' + head + "</thead><tbody>" + body + "</tbody></table>" +
      '<p class="du-sg-soon">All measurements in inches &nbsp;&middot;&nbsp; Tolerance &plusmn;' + g.tolerance + "</p>" +
    "</div>";
  }

  function buildModal() {
    var tabs = SIZE_GUIDE_ORDER.map(function (key, i) {
      return '<button class="du-sg-tab' + (i === 0 ? " is-active" : "") + '" data-sg-tab="' + key + '">' +
        SIZE_GUIDES[key].label + "</button>";
    }).join("");
    var panels = SIZE_GUIDE_ORDER.map(function (key, i) {
      return sizeGuidePanelHtml(key).replace(
        'class="du-sg-panel"',
        'class="du-sg-panel' + (i === 0 ? " is-active" : "") + '"'
      );
    }).join("");

    var modal = document.createElement("div");
    modal.className = "du-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML =
      '<div class="du-modal-card" role="dialog" aria-modal="true" aria-label="Size guide">' +
        '<div class="du-modal-head">' +
          "<div><span class=\"du-modal-eyebrow\" data-sg-eyebrow>Fit \u00B7 " + SIZE_GUIDES[SIZE_GUIDE_ORDER[0]].label + "</span>" +
          "<h2>Size Guide</h2></div>" +
          '<button class="du-x" data-modal-close><span class="gl">\u2715</span>Close</button>' +
        "</div>" +
        '<p class="du-modal-intro">Pieces are cut oversized and boxy. Measurements are garment-flat in inches \u2014 lay a garment you own flat and compare. Between sizes, size down for a cleaner fit, up for fuller drape.</p>' +
        '<div class="du-sg-tabs" role="tablist">' + tabs + "</div>" +
        panels +
        '<div class="du-measure">How to measure</div>' +
        '<ul class="du-measure-list">' +
          "<li><strong>Width</strong> \u2014 measured pit to pit, laid flat, then doubled for full circumference.</li>" +
          "<li><strong>Length</strong> \u2014 from the highest point of the shoulder straight to the hem.</li>" +
          "<li><strong>Sleeve</strong> \u2014 from the shoulder seam (or center back) to the cuff edge.</li>" +
        "</ul>" +
      "</div>";
    return modal;
  }

  function setSizeGuideTab(key) {
    if (!SIZE_GUIDES[key]) return;
    [].forEach.call(els.modal.querySelectorAll("[data-sg-tab]"), function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-sg-tab") === key);
    });
    [].forEach.call(els.modal.querySelectorAll("[data-sg-panel]"), function (panel) {
      panel.classList.toggle("is-active", panel.getAttribute("data-sg-panel") === key);
    });
    var eyebrow = els.modal.querySelector("[data-sg-eyebrow]");
    if (eyebrow) eyebrow.textContent = "Fit \u00B7 " + SIZE_GUIDES[key].label;
  }

  /* ======================================================================
     RENDER
     ====================================================================== */
  function money(n) {
    return "$" + n.toLocaleString("en-US");
  }

  function renderCart() {
    var body = els.cart.querySelector("[data-cart-body]");
    var foot = els.cart.querySelector("[data-cart-foot]");
    var head = els.cart.querySelector("[data-cart-headcount]");
    var count = cartCount();

    head.textContent = count === 0 ? "" : count + (count === 1 ? " piece" : " pieces");

    if (cart.length === 0) {
      body.className = "du-cart-empty";
      body.innerHTML =
        "<p>Your collection is empty.</p>" +
        '<a href="collection.html">Browse the series \u2192</a>';
      foot.style.display = "none";
      return;
    }

    body.className = "du-cart-body";
    body.innerHTML = cart.map(function (it, i) {
      return '<div class="du-citem">' +
        '<div class="du-citem-img" style="' + (it.img ? 'overflow:hidden' : 'background:' + swatchBg(it.kind)) + '">' +
          (it.img ? '<img src="' + it.img + '" style="width:100%;height:100%;object-fit:cover;display:block">' : '') +
        '</div>' +
        '<div class="du-citem-main">' +
          '<div class="du-citem-line"><span>' + it.plate + '</span><span class="sep">//</span><span>' + it.name + "</span></div>" +
          '<div class="du-citem-name">' + it.name + "</div>" +
          '<div class="du-citem-size">Size ' + it.size + (it.color ? " &middot; " + it.color : "") + "</div>" +
          '<div class="du-qty">' +
            '<button data-dec="' + i + '" aria-label="Decrease quantity">\u2212</button>' +
            "<span>" + it.qty + "</span>" +
            '<button data-inc="' + i + '" aria-label="Increase quantity">+</button>' +
          "</div>" +
        "</div>" +
        '<div class="du-citem-right">' +
          '<div class="du-citem-price">' + money(it.price * it.qty) + "</div>" +
          '<button class="du-citem-rm" data-rm="' + i + '">Remove</button>' +
        "</div>" +
      "</div>";
    }).join("");

    foot.style.display = "";
    foot.innerHTML =
      '<div class="du-cart-sub"><span class="lbl">Subtotal</span><span class="val">' + money(cartSubtotal()) + "</span></div>" +
      '<p class="du-cart-note">Shipping and tax calculated at checkout.</p>' +
      '<a class="du-cart-checkout" href="checkout.html">Proceed to Checkout</a>' +
      '<button class="du-cart-cont" data-cart-close>Continue browsing</button>';
  }

  function syncCount() {
    var n = cartCount();
    var label = "Cart (" + n + ")";
    [].forEach.call(document.querySelectorAll("[data-cart-toggle]"), function (a) {
      // Some pages pair the text label with an icon (shown on mobile via
      // CSS) inside a .nav-label-text span — update that span in place
      // instead of a.textContent, which would delete the icon markup.
      // aria-label is kept in sync too so the accessible name is correct
      // even when the icon, not the text, is what's visually shown.
      var textEl = a.querySelector(".nav-label-text");
      if (textEl) { textEl.textContent = label; a.setAttribute("aria-label", label); }
      else { a.textContent = label; }
    });
  }

  /* ======================================================================
     OPEN / CLOSE
     ====================================================================== */
  var openPanel = null;
  function lock() { document.documentElement.classList.add("du-lock"); document.body.classList.add("du-lock"); }
  function unlock() { document.documentElement.classList.remove("du-lock"); document.body.classList.remove("du-lock"); }

  function showScrim() { els.scrim.classList.add("is-open"); }
  function maybeHideScrim() {
    if (!els.menu.classList.contains("is-open") &&
        !els.cart.classList.contains("is-open")) {
      els.scrim.classList.remove("is-open");
    }
  }

  function openMenu() {
    closeCart(true);
    els.menu.classList.add("is-open");
    els.menu.setAttribute("aria-hidden", "false");
    showScrim(); lock(); openPanel = "menu";
  }
  function closeMenu(silent) {
    els.menu.classList.remove("is-open");
    els.menu.setAttribute("aria-hidden", "true");
    if (!silent) { maybeHideScrim(); if (!anyOpen()) unlock(); openPanel = null; }
  }
  function openCart() {
    closeMenu(true);
    renderCart();
    els.cart.classList.add("is-open");
    els.cart.setAttribute("aria-hidden", "false");
    showScrim(); lock(); openPanel = "cart";
  }
  function closeCart(silent) {
    els.cart.classList.remove("is-open");
    els.cart.setAttribute("aria-hidden", "true");
    if (!silent) { maybeHideScrim(); if (!anyOpen()) unlock(); openPanel = null; }
  }
  function openModal(garment) {
    if (garment && SIZE_GUIDES[garment]) setSizeGuideTab(garment);
    els.modal.classList.add("is-open");
    els.modal.setAttribute("aria-hidden", "false");
    lock();
  }
  function closeModal() {
    els.modal.classList.remove("is-open");
    els.modal.setAttribute("aria-hidden", "true");
    if (!anyOpen()) unlock();
  }
  function anyOpen() {
    return els.menu.classList.contains("is-open") ||
           els.cart.classList.contains("is-open") ||
           els.modal.classList.contains("is-open");
  }
  function closeAll() { closeMenu(true); closeCart(true); closeModal(); els.scrim.classList.remove("is-open"); unlock(); openPanel = null; }

  /* ======================================================================
     ACCORDION
     ====================================================================== */
  function initAccordions(root) {
    [].forEach.call((root || document).querySelectorAll(".du-acc-item.is-open"), function (item) {
      var panel = item.querySelector(".du-acc-panel");
      if (panel) panel.style.height = "auto";
    });
    [].forEach.call((root || document).querySelectorAll(".du-acc-trigger"), function (btn) {
      if (btn.__du) return; btn.__du = true;
      btn.addEventListener("click", function () {
        var item = btn.closest(".du-acc-item");
        var panel = item.querySelector(".du-acc-panel");
        var open = item.classList.contains("is-open");
        if (open) {
          panel.style.height = panel.scrollHeight + "px";
          requestAnimationFrame(function () { panel.style.height = "0px"; });
          item.classList.remove("is-open");
        } else {
          item.classList.add("is-open");
          panel.style.height = panel.scrollHeight + "px";
          panel.addEventListener("transitionend", function te() {
            panel.style.height = "auto";
            panel.removeEventListener("transitionend", te);
          });
        }
      });
    });
  }

  /* ======================================================================
     WIRE
     ====================================================================== */
  function readProduct(trigger) {
    // explicit data-* override, else read from the product page DOM
    var name = trigger.getAttribute("data-name");
    var plate = trigger.getAttribute("data-plate");
    var price = trigger.getAttribute("data-price");
    var slug = trigger.getAttribute("data-slug") || "";
    var kind = trigger.getAttribute("data-kind") || "model";
    var size;

    var activeSize = document.querySelector(".size.is-active");
    size = trigger.getAttribute("data-size") || (activeSize ? activeSize.textContent.trim() : "M");

    // Only set on products with more than one color (see product.html's
    // ?p= product-switch script) — absent here means "the catalog's sole
    // color," which the checkout backend already defaults to on its own.
    var color = trigger.getAttribute("data-color") || "";

    if (!name) {
      var t = document.querySelector(".product-title");
      name = t ? t.textContent.replace(/\s+/g, " ").trim() : "Piece";
    }
    if (!plate) {
      var eb = document.querySelector(".info-eyebrow");
      plate = eb ? (eb.textContent.match(/Piece\s*\d+/i) || ["Piece 01"])[0] : "Piece 01";
    }
    if (price == null) {
      var p = document.querySelector(".product-price");
      price = p ? p.textContent.replace(/[^0-9.]/g, "") : "0";
    }
    var img = trigger.getAttribute("data-img");
    if (!img) {
      var activeFrame = document.querySelector(".gallery-stage .frame.is-active img");
      if (activeFrame) img = activeFrame.getAttribute("src");
    }
    return {
      name: name, plate: plate, size: size, slug: slug, color: color,
      price: Math.round(parseFloat(price) || 0), kind: kind, img: img || "", qty: 1
    };
  }

  function wire() {
    /* triggers via event delegation so it survives any nav markup */
    document.addEventListener("click", function (e) {
      var t = e.target;
      var menuOpen = t.closest("[data-menu-toggle]");
      if (menuOpen) { e.preventDefault(); openMenu(); return; }

      var cartOpen = t.closest("[data-cart-toggle]");
      if (cartOpen) { e.preventDefault(); openCart(); return; }

      var sizeG = t.closest("[data-size-guide]");
      if (sizeG) {
        e.preventDefault(); closeMenu(true); els.scrim.classList.remove("is-open");
        openModal(sizeG.getAttribute("data-size-guide-garment"));
        return;
      }

      var sgTab = t.closest("[data-sg-tab]");
      if (sgTab) { e.preventDefault(); setSizeGuideTab(sgTab.getAttribute("data-sg-tab")); return; }

      var mGroup = t.closest(".du-mgroup-head");
      if (mGroup) { e.preventDefault(); toggleMenuGroup(mGroup.closest(".du-mgroup")); return; }

      var add = t.closest("[data-add-to-cart]");
      if (add) { e.preventDefault(); addToCart(readProduct(add)); openCart(); return; }

      if (t.closest("[data-menu-close]")) { closeMenu(); return; }
      if (t.closest("[data-cart-close]")) { closeCart(); return; }
      if (t.closest("[data-modal-close]")) { closeModal(); return; }
    });

    /* cart body interactions */
    els.cart.addEventListener("click", function (e) {
      var inc = e.target.closest("[data-inc]");
      if (inc) { setQty(+inc.getAttribute("data-inc"), +1); return; }
      var dec = e.target.closest("[data-dec]");
      if (dec) { setQty(+dec.getAttribute("data-dec"), -1); return; }
      var rm = e.target.closest("[data-rm]");
      if (rm) { removeItem(+rm.getAttribute("data-rm")); return; }
    });

    /* scrim + esc close */
    els.scrim.addEventListener("click", function () {
      if (openPanel === "menu") closeMenu();
      else if (openPanel === "cart") closeCart();
      else closeAll();
    });
    els.modal.addEventListener("click", function (e) {
      if (e.target === els.modal) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && anyOpen()) closeAll();
    });
  }

  /* ======================================================================
     INIT
     ====================================================================== */
  /* ======================================================================
     SERIES 02 VOTE — presentation-only local selection.
     No aggregate counts, no backend. One selection per device, stored in
     localStorage, changeable, restored on reload. Shared by every page
     that renders a .vote-section.
     ====================================================================== */
  var VOTE_KEY = "deangelo_vote_s02";

  var VOTE_CSS = [
    /* percentages/bars retired — selection is the only state shown */
    ".vote-section .vote-bar-wrap{display:none !important}",
    ".vote-section .vote-pct{display:none !important}",
    ".vote-section .vote-btn{cursor:pointer;display:block !important}",
    ".vote-section .vote-btn:focus-visible{outline:1px solid currentColor;outline-offset:3px}",
    ".vote-section .vote-card{cursor:pointer}",
    /* selected state: quiet dim on the others, never illegible */
    ".vote-section.has-selection .vote-card{opacity:.62}",
    ".vote-section.has-selection .vote-card.is-selected{opacity:1}",
    ".vote-section .vote-card.is-selected .vote-btn{border-color:currentColor}",
    /* retire legacy voted-state rules that hid the buttons */
    ".vote-section.has-voted .vote-btn{display:block !important}"
  ].join("");

  /* ---- footer wordmark: scroll-scrubbed shimmer -------------------------
     The ".watermark" DEANGELO wordmark at the bottom of every page's footer
     is rendered as a thin, subtle white OUTLINE (not a filled word) — like
     langchain.com's footer wordmark, our direct reference. A brighter
     outline copy sits on top, revealed only along a soft vertical band —
     bright dead-center, fading continuously left/right with no flat
     plateau, full letter-height (not a circular spot) — that sweeps
     left-to-right as the footer scrolls into view. Driven by scroll
     position each frame (rAF loop, no CSS transition, no setTimeout), but
     speed-capped: small scroll movements track the scroll 1:1 (feels
     directly connected), while a fast/large scroll jump doesn't snap the
     light straight to its new position — it advances at a fixed max speed
     and keeps animating for a few more frames after the scroll stops,
     until it catches up. Scrolling back up reverses the same way. The
     sweep only starts once the wordmark's top edge has actually entered
     the viewport, completes over a short fixed scroll distance (not
     stretched across all remaining scroll room), and comes to REST with
     the light on the last letters once the page is fully scrolled — it
     does not sweep past and leave the word dark.

     Technique: CSS can't gradient a text-stroke directly, so — matching
     how langchain.com actually does it (directly inspected: a dim base
     logo plus a brighter "strokes" copy revealed through a CSS
     mask-image) — this layers a second, absolutely-positioned copy of the
     wordmark text on top of the original, both stroked-outline/
     transparent-fill, and reveals the top copy through an animated
     mask-image rather than gradienting a fill. Respects
     prefers-reduced-motion. */
  var WATERMARK_STROKE_DIM = "rgba(255,255,255,.42)";
  var WATERMARK_STROKE_BRIGHT = "rgba(255,255,255,.95)";
  var WATERMARK_STROKE_WIDTH = "0.35px";
  var WATERMARK_LETTER_SPACING = "0.02em";
  var WATERMARK_SHIMMER_CSS = [
    ".du-watermark-shimmer{position:relative;color:transparent;letter-spacing:" + WATERMARK_LETTER_SPACING + ";",
    "-webkit-text-stroke:" + WATERMARK_STROKE_WIDTH + " " + WATERMARK_STROKE_DIM + ";",
    "text-stroke:" + WATERMARK_STROKE_WIDTH + " " + WATERMARK_STROKE_DIM + ";}",
    ".du-watermark-glow{position:absolute;inset:0;color:transparent;pointer-events:none;",
    "-webkit-text-stroke:" + WATERMARK_STROKE_WIDTH + " " + WATERMARK_STROKE_BRIGHT + ";",
    "text-stroke:" + WATERMARK_STROKE_WIDTH + " " + WATERMARK_STROKE_BRIGHT + ";",
    "-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;}"
  ].join("");

  function initWatermarkShimmer() {
    var els = document.querySelectorAll(".watermark");
    if (!els.length) return;

    var style = document.createElement("style");
    style.id = "du-watermark-shimmer-css";
    style.textContent = WATERMARK_SHIMMER_CSS;
    document.head.appendChild(style);

    // Word is ~8 letters ("DEANGELO"). BAND_IN_LETTERS: how many
    // letter-widths wide the bright vertical band's falloff is — tighter
    // = a narrower, more precise beam. REST_LETTER_INDEX: which letter
    // (0-based) the light comes to rest centered on once fully scrolled —
    // 7 is the last letter ("O"), so the beam's trailing falloff still
    // reaches back into the second-to-last letter ("L").
    var LETTERS = 8;
    var BAND_IN_LETTERS = 0.9;
    var REST_LETTER_INDEX = 7;
    var restCenterPct = ((REST_LETTER_INDEX + 0.5) / LETTERS) * 100;
    // Percentage-of-word-width the band's falloff spans each side of its
    // center — a fraction of letters expressed directly as a percentage of
    // the whole word, so it's independent of actual rendered pixel size.
    var bandPct = (BAND_IN_LETTERS / LETTERS) * 100;

    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var glows = [].map.call(els, function (el) {
      var glow = document.createElement("span");
      glow.className = "du-watermark-glow";
      glow.setAttribute("aria-hidden", "true");
      glow.textContent = el.textContent;
      el.classList.add("du-watermark-shimmer");
      el.appendChild(glow);
      return { el: el, glow: glow };
    });

    function maskFor(centerPct) {
      var lo = centerPct - bandPct;
      var hi = centerPct + bandPct;
      return "linear-gradient(90deg,transparent " + lo.toFixed(2) + "%,white " +
        centerPct.toFixed(2) + "%,transparent " + hi.toFixed(2) + "%)";
    }

    if (reduceMotion) {
      // No sweep — the light simply rests in its final position, static.
      var restMask = maskFor(restCenterPct);
      glows.forEach(function (g) {
        g.glow.style.webkitMaskImage = restMask;
        g.glow.style.maskImage = restMask;
      });
      return;
    }

    // START: the wordmark's top edge is exactly at the bottom edge of the
    // viewport — 0% visible, the very first instant any part of it could
    // be seen. Sweep never starts before this.
    // SWEEP_DISTANCE_IN_HEIGHTS: how much scroll distance (in multiples of
    // the wordmark's own height) the whole sweep takes to complete, once
    // started — kept short and fixed so it reads as one quick pass, not a
    // reveal stretched across all remaining scroll room.
    // MAX_PROGRESS_PER_FRAME: caps how fast the visible sweep can move each
    // frame. Small scroll movements change the target by less than this
    // cap, so the light still tracks the scroll 1:1 (feels directly
    // connected). A fast/large scroll jump changes the target by more than
    // the cap in one frame — instead of snapping straight there, the light
    // advances at this fixed max speed and keeps animating over the next
    // few frames until it catches up, like langchain.com's eased
    // ScrollTrigger scrub rather than an instant jump.
    var SWEEP_DISTANCE_IN_HEIGHTS = 1.0;
    var MAX_PROGRESS_PER_FRAME = 0.035;
    glows.forEach(function (g) { g.progress = 0; });
    var rafHandle = null;

    function targetProgress(rect, vh) {
      var start = vh;
      var end = start - rect.height * SWEEP_DISTANCE_IN_HEIGHTS;
      var t = (start - rect.top) / (start - end);
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      return t;
    }

    function tick() {
      var vh = window.innerHeight;
      var settled = true;

      glows.forEach(function (g) {
        var rect = g.el.getBoundingClientRect();
        var target = targetProgress(rect, vh);
        var diff = target - g.progress;

        if (Math.abs(diff) > MAX_PROGRESS_PER_FRAME) {
          g.progress += diff > 0 ? MAX_PROGRESS_PER_FRAME : -MAX_PROGRESS_PER_FRAME;
          settled = false;
        } else {
          g.progress = target;
        }

        // Center travels from fully past the left edge (progress 0, beam
        // entirely off the word) to resting ON the last letters (progress
        // 1). Reversing scroll direction just changes the target — the
        // same speed-capped catch-up logic handles it automatically.
        var centerX = -bandPct + g.progress * (restCenterPct + bandPct);
        var mask = maskFor(centerX);
        g.glow.style.webkitMaskImage = mask;
        g.glow.style.maskImage = mask;
      });

      rafHandle = settled ? null : requestAnimationFrame(tick);
    }

    function kick() {
      if (rafHandle == null) rafHandle = requestAnimationFrame(tick);
    }

    window.addEventListener("scroll", kick, { passive: true });
    window.addEventListener("resize", kick, { passive: true });
    tick();
  }

  function readVote() {
    try { return localStorage.getItem(VOTE_KEY); } catch (e) { return null; }
  }
  function writeVote(v) {
    try {
      if (v) localStorage.setItem(VOTE_KEY, v);
      else localStorage.removeItem(VOTE_KEY);
    } catch (e) { /* private mode — selection just won't persist */ }
  }

  function renderVote(selected) {
    [].forEach.call(document.querySelectorAll(".vote-section"), function (section) {
      section.classList.toggle("has-selection", !!selected);
      [].forEach.call(section.querySelectorAll(".vote-card"), function (card) {
        var isSel = !!selected && card.getAttribute("data-candidate") === selected;
        card.classList.toggle("is-selected", isSel);
        var btn = card.querySelector(".vote-btn");
        if (btn) {
          btn.textContent = isSel ? "Selected ✓" : "Select";
          btn.setAttribute("aria-pressed", isSel ? "true" : "false");
        }
      });
    });
  }

  function initVote() {
    var sections = document.querySelectorAll(".vote-section");
    if (!sections.length) return;

    var style = document.createElement("style");
    style.id = "du-vote-css";
    style.textContent = VOTE_CSS;
    document.head.appendChild(style);

    [].forEach.call(sections, function (section) {
      section.addEventListener("click", function (e) {
        var card = e.target.closest(".vote-card");
        if (!card || !section.contains(card)) return;
        var cand = card.getAttribute("data-candidate");
        if (!cand) return;
        var current = readVote();
        var next = current === cand ? null : cand; // clicking again clears
        writeVote(next);
        renderVote(next);
      });
    });

    renderVote(readVote());
  }

  function init() {
    var style = document.createElement("style");
    style.id = "du-site-ui";
    style.textContent = CSS;
    document.head.appendChild(style);

    els.scrim = document.createElement("div");
    els.scrim.className = "du-scrim";
    els.menu = buildMenu();
    els.cart = buildCart();
    els.modal = buildModal();

    document.body.appendChild(els.scrim);
    document.body.appendChild(els.menu);
    document.body.appendChild(els.cart);
    document.body.appendChild(els.modal);

    renderCart();
    syncCount();
    initAccordions(document);
    initVote();
    initWatermarkShimmer();
    // open the first menu group by default
    [].forEach.call(els.menu.querySelectorAll(".du-mgroup.is-open .du-msub-panel"), function (p) {
      p.style.height = "auto";
    });
    wire();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* expose a tiny hook for the page (optional) */
  window.DeangeloUI = {
    openMenu: function () { openMenu(); },
    openCart: function () { openCart(); },
    openSizeGuide: function (garment) { openModal(garment); },
    addToCart: addToCart,
    initAccordions: initAccordions
  };
})();
