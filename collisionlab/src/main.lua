--[[
  CollisionLab
  Love2D 11.x

  Option A shell: two educational labs in one app, state preserved per lab.

    Narrowphase  - SAT / GJK / MPR on one active pair
    Broadphase   - uniform grid / spatial hash with many bodies

  Global controls:
    F2            - toggle Narrowphase <-> Broadphase
    F11           - toggle fullscreen
    F1 / ?        - field notes (content follows active lab)
    R             - reset active lab scene
    Escape        - close help, or quit

  Touch (phones / tablets; the web wrapper passes --touch, and any touch switches it on):
    toolbar buttons press the same keys as above, one finger drags, two fingers twist to rotate
    (narrowphase) or pinch to change the cell size (broadphase), and dragging scrolls the info
    panel and the field notes.
]]

local COLORS = require("shared.colors")
local shell = require("shared.shell")
local helpui = require("shared.help_overlay")
local narrowLab = require("narrowphase.lab")
local broadLab = require("broadphase.lab")

local LAB_ORDER = { "narrow", "broad" }
local labs = {
  narrow = narrowLab,
  broad = broadLab,
}

local activeId = "narrow"
local active = narrowLab

-- Touch state
local touchIds = {}      -- active finger ids, in press order
local touchPos = {}      -- id -> { x, y }
local primary = nil      -- the finger driving the single-pointer interaction
local gesture = nil      -- two-finger twist / pinch state
local helpDragY = nil    -- one-finger scroll inside the field notes
local panelDragY = nil   -- one-finger scroll inside the info panel
local lastTouch = -1     -- time of the last touch event

local function setLab(id)
  if not labs[id] or activeId == id then
    return
  end
  activeId = id
  active = labs[id]
  helpui.setLab(id)
  active.enter(COLORS)
  love.window.setTitle("CollisionLab - " .. active.title())
end

local function toggleLab()
  if activeId == "narrow" then
    setLab("broad")
  else
    setLab("narrow")
  end
end

-- SDL also synthesizes mouse events from touches; drop those so a tap isn't handled twice
-- (twice would undo every toggle button). Nobody mixes a mouse and a finger within 0.6 s.
local function fromTouch(istouch)
  return istouch or (love.timer.getTime() - lastTouch) < 0.6
end

local function hasArg(list, want)
  for _, a in ipairs(list or {}) do
    if a == want then return true end
  end
  return false
end

function love.load(args, unfilteredArgs)
  if hasArg(args, "--touch") or hasArg(unfilteredArgs, "--touch") or hasArg(arg, "--touch") then
    shell.setTouch(true)
  end
  love.window.setTitle("CollisionLab - " .. active.title())
  love.graphics.setBackgroundColor(COLORS.bg)
  love.graphics.setLineStyle("smooth")
  love.graphics.setLineWidth(1.5)
  if love.math and love.math.setRandomSeed then
    love.math.setRandomSeed(os.time())
  end
  math.randomseed(os.time())

  helpui.setLab(activeId)
  active.enter(COLORS)
end

function love.update(dt)
  if active.update then
    -- Broadphase pauses motion while help is open; narrowphase only auto-steps
    if activeId == "broad" then
      active.update(dt, helpui.isOpen())
    elseif not helpui.isOpen() then
      active.update(dt)
    end
  end
end

function love.draw()
  shell.beginFrame()
  local L = active.draw()
  helpui.draw(COLORS, L)
end

local function runButton(b)
  if b.key then
    love.keypressed(b.key)
  elseif b.action then
    b.action()
  end
end

--- Shared by the mouse and a touch's primary finger. Returns what the press started.
local function pointerPressed(x, y, button)
  local consumed = helpui.mousepressed(x, y, button)
  if helpui.isOpen() then return "help" end
  if consumed then return "help" end
  if button == 1 then
    local b = shell.buttonAt(x, y)
    if b then
      runButton(b)
      return "button"
    end
  end
  if active.panelScrollHit and active.panelScrollHit(x, y) then return "panel" end
  active.mousepressed(x, y, button)
  return "lab"
end

function love.mousepressed(x, y, button, istouch)
  if fromTouch(istouch) then return end
  pointerPressed(x, y, button)
end

function love.mousereleased(x, y, button, istouch)
  if fromTouch(istouch) then return end
  if active.mousereleased then
    active.mousereleased(x, y, button)
  end
end

function love.mousemoved(x, y, dx, dy, istouch)
  if fromTouch(istouch) then return end
  if helpui.isOpen() then
    return
  end
  if active.mousemoved then
    active.mousemoved(x, y, dx, dy)
  end
end

function love.wheelmoved(wx, wy)
  if helpui.wheelmoved(wx, wy) then
    return
  end
  if helpui.isOpen() then
    return
  end
  local mx, my = love.mouse.getPosition()
  if active.panelScrollHit and active.panelScrollHit(mx, my) then
    active.scrollPanel(-wy * 40)
    return
  end
  if active.wheelmoved then
    active.wheelmoved(wx, wy)
  end
end

local function removeTouch(id)
  for i, v in ipairs(touchIds) do
    if v == id then
      table.remove(touchIds, i)
      return
    end
  end
end

local function twoFingers()
  local a, b = touchPos[touchIds[1]], touchPos[touchIds[2]]
  local dx, dy = b.x - a.x, b.y - a.y
  return math.atan2(dy, dx), math.sqrt(dx * dx + dy * dy), (a.x + b.x) / 2, (a.y + b.y) / 2
end

function love.touchpressed(id, x, y)
  lastTouch = love.timer.getTime()
  shell.setTouch(true)
  touchPos[id] = { x = x, y = y }
  touchIds[#touchIds + 1] = id

  if #touchIds == 1 then
    primary = id
    local what = pointerPressed(x, y, 1)
    if what == "help" and helpui.isOpen() then
      helpDragY = y
    elseif what == "panel" then
      panelDragY = y
    end
  elseif #touchIds == 2 and not helpui.isOpen() then
    -- A second finger turns the drag into a twist / pinch on whatever the first finger picked.
    if primary and active.mousereleased then
      active.mousereleased(x, y, 1)
    end
    primary, helpDragY, panelDragY = nil, nil, nil
    local ang, dist = twoFingers()
    gesture = { angle = ang, dist = dist }
  end
end

function love.touchmoved(id, x, y)
  lastTouch = love.timer.getTime()
  local p = touchPos[id]
  if not p then return end
  p.x, p.y = x, y

  if gesture and #touchIds >= 2 then
    local ang, dist, cx, cy = twoFingers()
    local dAng = ang - gesture.angle
    if dAng > math.pi then dAng = dAng - 2 * math.pi elseif dAng < -math.pi then dAng = dAng + 2 * math.pi end
    local scale = dist / math.max(gesture.dist, 1)
    gesture.angle, gesture.dist = ang, dist
    if active.gesture then
      active.gesture(dAng, scale, cx, cy, gesture)
    end
  elseif id == primary then
    if helpDragY then
      helpui.scrollBy(helpDragY - y)
      helpDragY = y
    elseif panelDragY then
      active.scrollPanel(panelDragY - y)
      panelDragY = y
    elseif not helpui.isOpen() and active.mousemoved then
      active.mousemoved(x, y)
    end
  end
end

function love.touchreleased(id, x, y)
  lastTouch = love.timer.getTime()
  touchPos[id] = nil
  removeTouch(id)
  if id == primary then
    primary, helpDragY, panelDragY = nil, nil, nil
    if active.mousereleased then
      active.mousereleased(x, y, 1)
    end
  end
  if #touchIds < 2 then
    gesture = nil
  end
end

function love.keypressed(key)
  if helpui.keypressed(key) then
    return
  end

  if key == "f2" then
    toggleLab()
    return
  end

  -- F11: fullscreen toggle. In the browser build (love.js) this is the only reliable way
  -- to go fullscreen: SDL owns the canvas resize and love.resize fires on enter and exit.
  if key == "f11" then
    love.window.setFullscreen(not love.window.getFullscreen())
    return
  end

  if key == "escape" then
    love.event.quit()
    return
  end

  if active.keypressed then
    active.keypressed(key)
  end
end

function love.resize(w, h)
  if active.resize then
    active.resize(w, h)
  end
end
