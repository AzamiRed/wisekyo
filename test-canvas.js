const { createCanvas, registerFont } = require("canvas");
const fs = require("fs");
const path = require("path");

registerFont(path.join(__dirname, "fonts/Impact.ttf"), { family: "Impact" });

const canvas = createCanvas(500, 200);
const ctx = canvas.getContext("2d");

ctx.fillStyle = "white";
ctx.fillRect(0,0,500,200);

ctx.fillStyle = "black";
ctx.font = "40px Impact";
ctx.textAlign = "center";
ctx.fillText("Hello Canvas!", 250, 100);

fs.writeFileSync(path.join(__dirname, "temp/test.png"), canvas.toBuffer("image/png"));
console.log("Test image created!");