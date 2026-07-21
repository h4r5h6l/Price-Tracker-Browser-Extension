console.log("Price Tracker Loaded");

let productTitle = "";

const hostname = window.location.hostname;

if (hostname.includes("amazon")) {
    productTitle =
        document.querySelector("#productTitle")?.innerText.trim();
}

else if (hostname.includes("temu")) {
    productTitle =
        document.querySelector("h1")?.innerText.trim();
}

else if (hostname.includes("mediamarkt")) {
    productTitle =
        document.querySelector("h1")?.innerText.trim();
}

if (productTitle) {
    console.log("Product Found:");
    console.log(productTitle);
}
else {
    console.log("No product title found");
}