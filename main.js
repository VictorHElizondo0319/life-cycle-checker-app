const { app, BrowserWindow, Menu } = require("electron")
const path = require("path")
const { spawn, execSync } = require("child_process")
const fs = require("fs")
const net = require("net")

let mainWindow = null
let apiProcess = null
let apiProcessPid = null
let mysqlProcess = null

// --------------------
// Paths
// --------------------
const APP_ROOT = __dirname
const MYSQL_BASE = path.join(APP_ROOT, "mysql")
const MYSQL_BIN = path.join(MYSQL_BASE, "bin", "mysqld.exe")
const MYSQL_DATA = path.join(MYSQL_BASE, "data")
const MYSQL_SYSTEM_DB = path.join(MYSQL_DATA, "mysql")
const MYSQL_INI = path.join(MYSQL_BASE, "my.ini")

// --------------------
// Logging
// --------------------
const logPath = path.join(app.getPath("userData"), "app.log")

function log(message, isError = false) {
  const timestamp = new Date().toISOString()
  const line = `[${timestamp}] ${isError ? "ERROR: " : ""}${message}\n`
  try {
    fs.appendFileSync(logPath, line, "utf8")
  } catch {}
  console[isError ? "error" : "log"](line.trim())
}

// --------------------
// Window
// --------------------
function createWindow() {
  Menu.setApplicationMenu(null)

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1200,
    minHeight: 800,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(APP_ROOT, "preload.js")
    }
  })

  const indexPath = path.join(APP_ROOT, "out", "index.html")
  log(`Loading UI: ${indexPath}`)

  mainWindow.loadFile(indexPath).catch(err => {
    log(`Failed to load UI: ${err.message}`, true)
  })
}

// --------------------
// MySQL Init
// --------------------
function ensureMySQLInitialized() {
  if (fs.existsSync(MYSQL_SYSTEM_DB)) {
    log("MySQL already initialized")
    return
  }

  log("MySQL not initialized — initializing")

  execSync(
    `"${MYSQL_BIN}" --initialize-insecure --basedir="${MYSQL_BASE}" --datadir="${MYSQL_DATA}"`,
    { stdio: "inherit", cwd: path.join(MYSQL_BASE, "bin") }
  )

  log("MySQL initialization complete")
}

// --------------------
// Start MySQL
// --------------------
function startMySQL() {
  ensureMySQLInitialized()

  log("Starting MySQL (background)")

  mysqlProcess = spawn(
    MYSQL_BIN,
    ["--defaults-file=../my.ini"],
    {
      cwd: path.join(MYSQL_BASE, "bin"),
      windowsHide: true,
      detached: false,
      shell: false,
      stdio: "ignore"
    }
  )

  mysqlProcess.on("error", err => {
    log(`MySQL spawn error: ${err.message}`, true)
  })
}

// --------------------
// Wait for MySQL
// --------------------
function waitForMySQL(port = 3306, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()

    function probe() {
      const socket = new net.Socket()
      socket.setTimeout(1000)

      socket.on("connect", () => {
        socket.destroy()
        log("MySQL is ready")
        resolve()
      })

      socket.on("error", () => {
        socket.destroy()
        if (Date.now() - start > timeout) {
          reject(new Error("MySQL startup timeout"))
        } else {
          setTimeout(probe, 500)
        }
      })

      socket.connect(port, "127.0.0.1")
    }

    probe()
  })
}

// --------------------
// Start API
// --------------------
function startApi() {
  const apiPath = path.join(APP_ROOT, "api.exe")

  log(`Starting API: ${apiPath}`)

  apiProcess = spawn(apiPath, [], {
    windowsHide: true,
    detached: false,
    shell: false,
    stdio: "ignore"
  })

  apiProcessPid = apiProcess.pid
  log(`API started (PID: ${apiProcessPid})`)
}

// --------------------
// Kill API
// --------------------
function killApi() {
  if (!apiProcessPid) return

  try {
    log(`Killing API (PID: ${apiProcessPid})`)
    execSync(`taskkill /F /T /PID ${apiProcessPid}`)
  } catch {}
  apiProcessPid = null
  apiProcess = null
}

// --------------------
// Kill MySQL (CORRECT WAY)
// --------------------
function killMySQL() {
  try {
    log("Killing MySQL (mysqld.exe)")
    execSync(`taskkill /F /T /IM mysqld.exe`)
  } catch (err) {
    log(`MySQL kill skipped: ${err.message}`)
  }
  mysqlProcess = null
}

// --------------------
// App Lifecycle
// --------------------
app.whenReady().then(async () => {
  log("Application starting")

  try {
    startMySQL()
    await waitForMySQL()
    startApi()
    createWindow()
  } catch (err) {
    log(`Startup failed: ${err.message}`, true)
    app.quit()
  }
})

// --------------------
// Shutdown
// --------------------
app.on("before-quit", () => {
  log("Application shutting down")
  killApi()
  killMySQL()
})

// --------------------
// Crash Safety
// --------------------
process.on("uncaughtException", err => {
  log(`Uncaught exception: ${err.message}`, true)
  killApi()
  killMySQL()
})

process.on("unhandledRejection", reason => {
  log(`Unhandled rejection: ${reason}`, true)
  killApi()
  killMySQL()
})
