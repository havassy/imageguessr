// Állandók
const N_ROUNDS = 5;
const PENALTY_KM = 10000;

// Globális állapot
let places = [];
let selectedPlaces = [];
let currentRound = 0;          // 0..N_ROUNDS-1
let currentPlace = null;
let map = null;
let guessMarker = null;        // aktuális tipp marker (kör közben)
let solutionMarker = null;     // aktuális kör valódi helye
let currentLine = null;        // aktuális kör vonala
let solutionShownThisRound = false;


// Játék teljes története: 5 elem, mindegyikben tipp, valódi hely, hiba
let roundsData = [];           // {place, guessLat, guessLng, errorKm}

// Tanúsítvány állapot: van-e fokozat, és melyik
let certificateLevel = null;   // "bronze" | "silver" | "gold" | null

// Inicializálás
async function initGame() {
  try {
    const resp = await fetch("places.json");
    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) {
      alert("Hiba: üres vagy hibás places.json.");
      return;
    }
    places = data;

    document.getElementById("btnNewGame").addEventListener("click", startNewGame);
    document.getElementById("btnShowSolution").addEventListener("click", showSolution);
    document.getElementById("btnNextRound").addEventListener("click", nextRound);

    document.getElementById("btnCloseResults").addEventListener("click", () => {
      hideResultsModal();
      resetState();
    });
    document.getElementById("btnCloseResults2").addEventListener("click", () => {
      hideResultsModal();
      resetState();
    });

    document.getElementById("btnDownloadCert").addEventListener("click", downloadCertificate);

    // névmező: ha üres, a gomb legyen tiltva
    document.getElementById("playerName").addEventListener("input", () => {
      const name = document.getElementById("playerName").value.trim();
      document.getElementById("btnDownloadCert").disabled = name.length === 0;
    });

    initMap();
  } catch (e) {
    console.error("Init error:", e);
    alert("Nem sikerült betölteni a places.json fájlt.");
  }
}

function initMap() {
  map = L.map("map").setView([40, -10], 3);

  L.tileLayer('https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png', {
    minZoom: 3,
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  // Tippelés engedélyezése – EZZEL lesz kattintható
  map.on("click", onMapClick);
}

function resetState() {
  selectedPlaces = [];
  currentRound = 0;
  currentPlace = null;
  roundsData = [];
  certificateLevel = null;

  document.getElementById("currentRound").textContent = "0";

  // Startkép visszaállítása
  const img = document.getElementById("gameImage");
  if (img) {
    img.src = "img/start.jpg";
    img.alt = "Kezdő kép";
  }

  // Kezdő szöveg az info panelben
  const infoPanel = document.getElementById("infoPanel");
  if (infoPanel) {
    infoPanel.innerHTML = `
      <p>Kattints az <strong>Új játék indítása</strong> gombra, majd jelöld meg a térképen a kép földrajzi helyzetét. Az eredmény pontosságától függően bronz, ezüst vagy arany fokozatú igazolást lehet letölteni a játék elvégzéséről.</p>
    `;
  }

  const resultsOverlay = document.getElementById("resultsOverlay");
  if (resultsOverlay) resultsOverlay.style.display = "none";

  const tbody = document.querySelector("#roundTable tbody");
  if (tbody) tbody.innerHTML = "";
  const totalEl = document.getElementById("totalErrorKm");
  if (totalEl) totalEl.textContent = "0";

  document.getElementById("certificateMessage").textContent = "";
  document.getElementById("certificateArea").style.display = "none";
  document.getElementById("noCertButtons").style.display = "flex";
  document.getElementById("playerName").value = "";
  document.getElementById("btnDownloadCert").disabled = true;

  if (guessMarker) { map.removeLayer(guessMarker); guessMarker = null; }
  if (solutionMarker) { map.removeLayer(solutionMarker); solutionMarker = null; }
  if (currentLine) { map.removeLayer(currentLine); currentLine = null; }

  // Csak a tile layer maradjon
  map.eachLayer(layer => {
    if (!(layer instanceof L.TileLayer)) {
      map.removeLayer(layer);
    }
  });

  map.setView([40, -10], 3);
}

function startNewGame() {
  resetState();

  // 5 véletlen hely kiválasztása
  selectedPlaces = shuffle(places).slice(0, N_ROUNDS);
  currentRound = 0;
  roundsData = new Array(N_ROUNDS).fill(null);

  loadRound();
}

function loadRound() {
  if (currentRound >= N_ROUNDS) {
    showResults();
    return;
  }

  solutionShownThisRound = false;  // új kör: még nincs megoldás megmutatva

  currentPlace = selectedPlaces[currentRound];
  document.getElementById("currentRound").textContent = String(currentRound + 1);

  const img = document.getElementById("gameImage");
  img.src = "img/" + currentPlace.image;
  img.alt = currentPlace.title;

  if (guessMarker) { map.removeLayer(guessMarker); guessMarker = null; }
  if (solutionMarker) { map.removeLayer(solutionMarker); solutionMarker = null; }
  if (currentLine) { map.removeLayer(currentLine); currentLine = null; }

  document.getElementById("btnShowSolution").disabled = true;
  document.getElementById("btnNextRound").disabled = true;
  document.getElementById("btnNextRound").textContent =
    currentRound === N_ROUNDS - 1 ? "Eredmény" : "Következő kör";

  const infoPanel = document.getElementById("infoPanel");
  if (infoPanel) infoPanel.innerHTML = "";

  map.setView([40, -10], 3);
}


// Tipp a térképen
function onMapClick(e) {
  if (!currentPlace) return;          // még nem indult játék
  if (solutionShownThisRound) return; // megoldás után ne engedj új tippet

  const latlng = e.latlng;

  if (guessMarker) {
    map.removeLayer(guessMarker);
  }

  guessMarker = L.circleMarker([latlng.lat, latlng.lng], {
    radius: 8,
    color: "blue",
    fillColor: "blue",
    fillOpacity: 0.9
  }).addTo(map);

  roundsData[currentRound] = {
    place: currentPlace,
    guessLat: latlng.lat,
    guessLng: latlng.lng,
    errorKm: null
  };

  document.getElementById("btnShowSolution").disabled = false;
}


// Megoldás mutatása az aktuális körre
function showSolution() {
  if (!currentPlace || !roundsData[currentRound]) return;

  const data = roundsData[currentRound];
  const sol = currentPlace;

  const guessLat = data.guessLat;
  const guessLng = data.guessLng;

  if (solutionMarker) { map.removeLayer(solutionMarker); }
  if (currentLine) { map.removeLayer(currentLine); }

  solutionMarker = L.marker([sol.lat, sol.lng]).addTo(map);

  currentLine = L.polyline(
    [
      [guessLat, guessLng],
      [sol.lat, sol.lng]
    ],
    { color: "red", weight: 3 }
  ).addTo(map);

  const d = haversine(guessLat, guessLng, sol.lat, sol.lng);
  data.errorKm = d;

  const hibakm = d.toFixed(0);

  const infoPanel = document.getElementById("infoPanel");
  if (infoPanel) {
    infoPanel.innerHTML = `
      <p><strong>Hiba:</strong> ${hibakm} km</p>
      <p><strong>Hely:</strong> ${sol.title}</p>
      <p><strong>Leírás:</strong> ${sol.info}</p>
    `;
  }

  document.getElementById("btnShowSolution").disabled = true;
  document.getElementById("btnNextRound").disabled = false;

  const bounds = L.latLngBounds(
    [guessLat, guessLng],
    [sol.lat, sol.lng]
  );
  map.fitBounds(bounds, { padding: [20, 20] });

  // ÚJ SOR: innentől ebben a körben nincs több tipp
  solutionShownThisRound = true;
}


// Következő kör / Eredmény
function nextRound() {
  currentRound++;
  if (currentRound < N_ROUNDS) {
    loadRound();
  } else {
    showResults();
  }
}

// Eredmények megjelenítése + összesítő térkép + fokozat
function showResults() {
  const infoPanel = document.getElementById("infoPanel");
  if (infoPanel) infoPanel.innerHTML = "";

  // Ha valahol nem volt tipp, büntető
  for (let i = 0; i < N_ROUNDS; i++) {
    if (!roundsData[i]) {
      roundsData[i] = {
        place: selectedPlaces[i],
        guessLat: null,
        guessLng: null,
        errorKm: PENALTY_KM
      };
    } else if (roundsData[i].errorKm === null) {
      const p = selectedPlaces[i];
      const gLat = roundsData[i].guessLat;
      const gLng = roundsData[i].guessLng;
      const d = haversine(gLat, gLng, p.lat, p.lng);
      roundsData[i].errorKm = d;
    }
  }

  // Összesítés táblázat
  const tbody = document.querySelector("#roundTable tbody");
  tbody.innerHTML = "";
  let total = 0;

  const errors = [];

  roundsData.forEach((r, idx) => {
    const tr = document.createElement("tr");
    const err = r.errorKm;
    total += err;
    errors.push(err);

    const tdRound = document.createElement("td");
    tdRound.textContent = (idx + 1).toString();
    const tdErr = document.createElement("td");
    tdErr.textContent = Math.round(err).toString();

    tr.appendChild(tdRound);
    tr.appendChild(tdErr);
    tbody.appendChild(tr);
  });

  const totalRounded = Math.round(total);
  document.getElementById("totalErrorKm").textContent = totalRounded.toString();

  // Fokozat meghatározása – csak ha MIND az 5 hiba ugyanabba a sávba esik
  certificateLevel = determineCertificateLevel(errors);

  const certMessageEl = document.getElementById("certificateMessage");
  const certArea = document.getElementById("certificateArea");
  const noCertButtons = document.getElementById("noCertButtons");

  if (certificateLevel) {
    certMessageEl.textContent = "Letöltheted a játék elvégzését igazoló képet.";
    certArea.style.display = "block";
    noCertButtons.style.display = "none";
    document.getElementById("playerName").value = "";
    document.getElementById("btnDownloadCert").disabled = true;
  } else {
    certMessageEl.textContent = "Játssz még egy kört az igazolás letöltéséért!";
    certArea.style.display = "none";
    noCertButtons.style.display = "flex";
  }

  // Térkép: régi marker/vonalak törlése (csak a tile layer maradjon)
  if (guessMarker) { map.removeLayer(guessMarker); guessMarker = null; }
  if (solutionMarker) { map.removeLayer(solutionMarker); solutionMarker = null; }
  if (currentLine) { map.removeLayer(currentLine); currentLine = null; }

  map.eachLayer(layer => {
    if (!(layer instanceof L.TileLayer)) {
      map.removeLayer(layer);
    }
  });

  // Összes kör tippje + valódi helye
  const allMarkers = [];

  roundsData.forEach((r) => {
    const p = r.place;

    // valódi hely (piros marker)
    const realMarker = L.circleMarker([p.lat, p.lng], {
      radius: 6,
      color: "red",
      fillColor: "red",
      fillOpacity: 0.9
    }).addTo(map);
    allMarkers.push(realMarker);

    if (r.guessLat !== null && r.guessLng !== null) {
      // tipp (kék marker)
      const guessM = L.circleMarker([r.guessLat, r.guessLng], {
        radius: 6,
        color: "blue",
        fillColor: "blue",
        fillOpacity: 0.9
      }).addTo(map);
      allMarkers.push(guessM);

      // vonal
      L.polyline(
        [
          [r.guessLat, r.guessLng],
          [p.lat, p.lng]
        ],
        { color: "gray", weight: 2, dashArray: "4 4" }
      ).addTo(map);
    }
  });

    if (allMarkers.length > 0) {
    const group = L.featureGroup(allMarkers);
    map.fitBounds(group.getBounds(), { padding: [20, 20] });
  }

  // Játék vége után a "Következő kör / Eredmény" gomb ne legyen használható
  const nextBtn = document.getElementById("btnNextRound");
  if (nextBtn) {
    nextBtn.disabled = true;
  }

  // Modal megjelenítése
  document.getElementById("resultsOverlay").style.display = "flex";
}

// Meghatározza a fokozatot a hibák alapján
function determineCertificateLevel(errors) {
  // Arany: nincs 10 km-nél nagyobb hiba
  const maxErr = Math.max(...errors);

  if (maxErr <= 9) {
    return "gold";
  }

  // Ezüst: nincs 100 km-nél nagyobb hiba, és van legalább egy 10–99 km közötti
  const hasSilverRange = errors.some(e => e >= 10 && e <= 99);
  if (maxErr <= 99 && hasSilverRange) {
    return "silver";
  }

  // Bronz: nincs 1000 km-nél nagyobb hiba, és van legalább egy 100–999 km közötti
  const hasBronzeRange = errors.some(e => e >= 100 && e <= 999);
  if (maxErr <= 999 && hasBronzeRange) {
    return "bronze";
  }

  // Különben nincs igazolás
  return null;
}

// Modal elrejtése
function hideResultsModal() {
  document.getElementById("resultsOverlay").style.display = "none";
}

// Tanúsítvány letöltése
function downloadCertificate() {
  if (!certificateLevel) return;

  const playerNameInput = document.getElementById("playerName");
  const playerName = playerNameInput.value.trim() || "Névtelen játékos";

  // Canvas előkészítése
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 800;
  const ctx = canvas.getContext("2d");

  // Háttérszín a fokozat szerint
  let bgColor;
  let titleText;

  switch (certificateLevel) {
    case "gold":
      bgColor = "#ffd700"; // arany
      titleText = "ARANY FOKOZAT";
      break;
    case "silver":
      bgColor = "#c0c0c0"; // ezüst
      titleText = "EZÜST FOKOZAT";
      break;
    case "bronze":
      bgColor = "#c18b44"; // barnás bronz
      titleText = "BRONZ FOKOZAT";
      break;
    default:
      bgColor = "#ffffff";
      titleText = "RÉSZVÉTELI IGAZOLÁS";
      break;
  }

  // Külső „keret”
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Belső fehér „lap” – vastagabb keret
  const margin = 80;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(
    margin,
    margin,
    canvas.width - 2 * margin,
    canvas.height - 2 * margin
  );

  // Cím – fokozat
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.font = "bold 46px Arial";
  ctx.fillText(titleText, canvas.width / 2, 150);

  // Emojik a cím alatt
  const emojis = ["⛰️", "🌲", "🌳", "☀️", "⛅", "🌈", "🌊", "🌋", "🗺️", "🏝️", "🏔️", "🏞️"];
  let emojiCount = 1;
  if (certificateLevel === "silver") emojiCount = 2;
  if (certificateLevel === "gold") emojiCount = 3;

  const shuffled = shuffle(emojis);
  const chosen = shuffled.slice(0, emojiCount);

  ctx.font = "48px Arial";
  const baseY = 210;
  const baseX = canvas.width / 2;
  const offset = 70;

  chosen.forEach((emoji, idx) => {
    let x = baseX;
    if (emojiCount === 2) {
      x = baseX + (idx === 0 ? -offset / 2 : offset / 2);
    } else if (emojiCount === 3) {
      x = baseX + (idx - 1) * offset;
    }
    ctx.fillText(emoji, x, baseY);
  });

  // Név + szövegek középre igazítva (függőlegesen is)
  ctx.textAlign = "center";

  const innerTop = margin;
  const innerBottom = canvas.height - margin;
  const centerY = (innerTop + innerBottom) / 2;
  const lineHeight = 40;

  // 1) Név
  ctx.font = "30px Arial";
  ctx.fillText(playerName, canvas.width / 2, centerY - lineHeight);

  // 2) Szöveg: „sikeresen elvégezte az ImageGuessr földrajzi képrejtvényt”

  // ideiglenesen balra igazítunk, hogy tudjunk méréssel középre tenni
  ctx.textAlign = "left";
  ctx.font = "22px Arial";

  const prefix = "sikeresen elvégezte az ";
  const boldWord = "ImageGuessr ";
  const suffix = " földrajzi képrejtvényt";

  const prefixWidth = ctx.measureText(prefix).width;
  const wordWidth = ctx.measureText(boldWord).width;
  const suffixWidth = ctx.measureText(suffix).width;
  const totalWidth = prefixWidth + wordWidth + suffixWidth;

  let x = (canvas.width - totalWidth) / 2;

  // 1) előtag – fekete
  ctx.fillStyle = "#000000";
  ctx.font = "22px Arial";
  ctx.fillText(prefix, x, centerY);
  x += prefixWidth;

  // 2) ImageGuessr – félkövér, kék
  ctx.font = "bold 22px Arial";
  ctx.fillStyle = "#1976d2";
  ctx.fillText(boldWord, x, centerY);
  x += wordWidth;

  // 3) utótag – fekete
  ctx.font = "22px Arial";
  ctx.fillStyle = "#000000";
  ctx.fillText(suffix, x, centerY);

  // !!! innentől újra középre igazítunk a következő sorokhoz
  ctx.textAlign = "center";

  // 3) Összesített hiba
  const totalText = document.getElementById("totalErrorKm").textContent || "0";
  const totalNumber = parseInt(totalText, 10) || 0;
  const totalError = totalNumber.toLocaleString("hu-HU");

  ctx.fillText(
    `Összesített hiba: ${totalError} km`,
    canvas.width / 2,
    centerY + lineHeight
  );

  // 4) Dátum
  const now = new Date();
  const dateStr = now.toLocaleString("hu-HU");
  ctx.fillText(
    `Dátum: ${dateStr}`,
    canvas.width / 2,
    centerY + 2 * lineHeight
  );

  // 5) Záró szöveg
  ctx.font = "18px Arial";
  ctx.fillText(
    "Gratulálunk az eredményhez.",
    canvas.width / 2,
    centerY + 3 * lineHeight
  );

  // Letöltés indítása
  const link = document.createElement("a");
  link.download = `imageguessr_${certificateLevel}_${dateStr.replace(/[^0-9]/g, "")}.png`;
  link.href = canvas.toDataURL("image/png");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Letöltés után vissza a kezdőképernyőre
  hideResultsModal();
  resetState();
}

// Haversine – km
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Egyszerű keverő
function shuffle(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Oldal betöltésekor
window.addEventListener("load", initGame);
