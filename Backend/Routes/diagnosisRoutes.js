// routes/diagnosis.js
const express = require("express");
const { generateClinicalSuggestions } = require("../Controllers/diagnosisController");
const router = express.Router();

router.post("/diagnose", generateClinicalSuggestions);
module.exports = router;
