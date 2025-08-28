const express=require("express");
const cors=require("cors");
const diagnosisRoutes=require("./Routes/diagnosisRoutes");
require("dotenv").config({
    path:"./.env"
});
const app=express();

app.use(cors());
app.use(express.json());
app.use("/api/diagnosis", diagnosisRoutes);

const PORT=process.env.PORT||5000;
app.listen(PORT,()=>{
    console.log(`Server is running on port ${PORT}`);
});
