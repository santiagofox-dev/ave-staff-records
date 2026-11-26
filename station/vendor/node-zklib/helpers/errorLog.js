const fs = require('fs')

const parseCurrentTime = ()=>{
    const currentTime = new Date()
    return {
        year: currentTime.getFullYear(),
        month: currentTime.getMonth()+1,
        day : currentTime.getDate(),
        hour: currentTime.getHours(),
        second: currentTime.getSeconds()
    }
}


module.exports.log = (text)=>{
    const currentTime = parseCurrentTime()
    // AVE: write the library's log next to our own logs instead of the current folder
    fs.appendFile(require('path').join(process.env.AVE_LOG_DIR || '.', `${currentTime.day}`.padStart(2,'0')+ `${currentTime.month}`.padStart(2,'0')+`${currentTime.year}.err.log`)
    ,`\n [${currentTime.hour}:${currentTime.second}] ${text}`,()=>{});
}