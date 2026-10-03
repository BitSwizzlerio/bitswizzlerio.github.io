--[[
  Broadphase lab mode: uniform grid / spatial hash with many bodies.
  Module API for the CollisionLab shell.
]]

local shapes = require("broadphase.shapes")
local SpatialHash = require("broadphase.spatial_hash")
local narrow = require("broadphase.narrow")
local draw = require("broadphase.draw")
local shell = require("shared.shell")

local lab = {}

local COLORS
local bodies = {}
local hash = SpatialHash.new(72)
local shapeSetIndex = 1
local bodyCount = 28
local paused = false
local showGrid = true
local showCandidates = true
local showProxies = true
local selected = nil
local drag = { active = false, ox = 0, oy = 0 }
local candidates = {}
local hits = {}
local hitBodies = {}
local methodCounts = {}
local stats = {
  n = 0, brutePairs = 0, candidates = 0, hits = 0,
  occupiedCells = 0, registrations = 0, cellPairChecks = 0,
  culled = 0, cullPct = 0,
}
local entered = false
local panelScroll, panelMax = 0, 0
local panelView = nil             -- scrollable info area (toolbar layouts only)

local SHAPE_SETS = {
  {
    id = "aabb",
    name = "AABB vs AABB",
    desc = "Every body is an axis-aligned box. Narrowphase is pure AABB-AABB. " ..
      "Broadphase and narrowphase both work on the same rectangles.",
  },
  {
    id = "mixed",
    name = "AABB vs circle",
    desc = "Mix of boxes and disks. Hash still uses AABB proxies; narrowphase " ..
      "dispatches AABB-AABB, AABB-circle, or circle-circle per candidate pair.",
  },
}

local function currentSet()
  return SHAPE_SETS[shapeSetIndex]
end

local function layout()
  local R = shell.regions()
  return { mode = R.mode, w = R.w, h = R.h, panelW = R.panelW, world = R.world, panel = R.panel, region = R.world }
end

local function playfield(L)
  local margin = 8
  return {
    x = L.world.x + margin,
    y = L.world.y + margin,
    w = L.world.w - margin * 2,
    h = L.world.h - margin * 2,
  }
end

local function randSpeed()
  local s = 40 + love.math.random() * 90
  local a = love.math.random() * math.pi * 2
  return math.cos(a) * s, math.sin(a) * s
end

local function spawnBodies(bounds)
  bodies = {}
  local set = currentSet()
  for i = 1, bodyCount do
    local body
    local useCircle = (set.id == "mixed") and (i % 2 == 0)
    if useCircle then
      local r = 12 + love.math.random() * 18
      body = shapes.circle(
        bounds.x + r + love.math.random() * (bounds.w - 2 * r),
        bounds.y + r + love.math.random() * (bounds.h - 2 * r),
        r,
        tostring(i)
      )
    else
      local bw = 22 + love.math.random() * 36
      local bh = 18 + love.math.random() * 32
      body = shapes.aabb(
        bounds.x + bw * 0.5 + love.math.random() * (bounds.w - bw),
        bounds.y + bh * 0.5 + love.math.random() * (bounds.h - bh),
        bw,
        bh,
        tostring(i)
      )
    end
    body.id = i
    body.vx, body.vy = randSpeed()
    bodies[i] = body
  end
  selected = nil
end

local function bounce(body, bounds)
  local a = body:aabb()
  if a.minX < bounds.x then
    body.x = body.x + (bounds.x - a.minX)
    body.vx = math.abs(body.vx)
  elseif a.maxX > bounds.x + bounds.w then
    body.x = body.x - (a.maxX - (bounds.x + bounds.w))
    body.vx = -math.abs(body.vx)
  end
  if a.minY < bounds.y then
    body.y = body.y + (bounds.y - a.minY)
    body.vy = math.abs(body.vy)
  elseif a.maxY > bounds.y + bounds.h then
    body.y = body.y - (a.maxY - (bounds.y + bounds.h))
    body.vy = -math.abs(body.vy)
  end
end

local function recomputeBroadphase()
  hash:clear()
  for i, b in ipairs(bodies) do
    b.id = i
    hash:insert(i, b:aabb())
  end

  local pairList, hstats = hash:queryPairs()
  candidates = pairList
  hits = {}
  hitBodies = {}
  methodCounts = {}

  local hitCount = 0
  for _, pair in ipairs(candidates) do
    local ba, bb = bodies[pair.a], bodies[pair.b]
    local ok, method = narrow.test(ba, bb)
    if ok then
      hitCount = hitCount + 1
      local key = pair.a .. ":" .. pair.b
      hits[key] = method
      hitBodies[pair.a] = true
      hitBodies[pair.b] = true
      methodCounts[method] = (methodCounts[method] or 0) + 1
    end
  end

  local n = #bodies
  local brute = n * (n - 1) / 2
  local cand = #candidates
  stats = {
    n = n,
    brutePairs = brute,
    candidates = cand,
    hits = hitCount,
    occupiedCells = hstats.occupiedCells,
    registrations = hstats.registrations,
    cellPairChecks = hstats.cellPairChecks,
    culled = brute - cand,
    cullPct = brute > 0 and (100 * (brute - cand) / brute) or 0,
  }
end

local function resetScene()
  local L = layout()
  spawnBodies(playfield(L))
  recomputeBroadphase()
end

function lab.id()
  return "broad"
end

function lab.title()
  return "Broadphase  -  Uniform Grid / Spatial Hash"
end

function lab.enter(colors)
  COLORS = colors
  if not entered then
    resetScene()
    entered = true
  else
    -- Re-clamp after possible window size change while away
    local L = layout()
    local bounds = playfield(L)
    for _, b in ipairs(bodies) do
      shapes.clampToBounds(b, bounds, 0)
    end
    recomputeBroadphase()
  end
  drag.active = false
end

function lab.reset()
  resetScene()
end

function lab.update(dt, helpOpen)
  if helpOpen then
    return
  end
  if paused or drag.active then
    recomputeBroadphase()
    return
  end

  local L = layout()
  local bounds = playfield(L)
  for _, b in ipairs(bodies) do
    b.x = b.x + b.vx * dt
    b.y = b.y + b.vy * dt
    bounce(b, bounds)
  end
  recomputeBroadphase()
end

local function hitTest(x, y)
  for i = #bodies, 1, -1 do
    if shapes.pointIn(bodies[i], x, y) then
      return bodies[i]
    end
  end
  return nil
end

local function drawWorld(L)
  local bounds = playfield(L)
  local W = L.world

  draw.withScissor(W.x, W.y, W.w, W.h, function()
    love.graphics.setColor(0.10, 0.11, 0.14)
    love.graphics.rectangle("fill", W.x, W.y, W.w, W.h)

    love.graphics.setColor(0.16, 0.18, 0.22)
    love.graphics.rectangle("fill", bounds.x, bounds.y, bounds.w, bounds.h)

    if showGrid then
      draw.gridLines(bounds, hash.cellSize, COLORS)
      hash:forEachOccupied(function(_, _, bucket, rect)
        if rect.x + rect.w < bounds.x or rect.x > bounds.x + bounds.w then return end
        if rect.y + rect.h < bounds.y or rect.y > bounds.y + bounds.h then return end
        draw.occupiedCell(rect, #bucket, COLORS)
      end)
    end

    if showCandidates then
      for _, pair in ipairs(candidates) do
        local ba, bb = bodies[pair.a], bodies[pair.b]
        local key = pair.a .. ":" .. pair.b
        if hits[key] then
          draw.pairLine(ba.x, ba.y, bb.x, bb.y, COLORS.hit, 0.75)
        else
          draw.pairLine(ba.x, ba.y, bb.x, bb.y, COLORS.candidate, 0.40)
        end
      end
    end

    for _, b in ipairs(bodies) do
      draw.body(b, COLORS, {
        colliding = hitBodies[b.id],
        selected = selected == b,
        showProxy = showProxies,
      })
    end
  end)

  love.graphics.setColor(COLORS.text)
  love.graphics.print("World space  -  spatial hash broadphase", W.x + 12, W.y + 10)
  love.graphics.setColor(COLORS.muted)
  love.graphics.print(
    currentSet().name .. "   |   cell " .. tostring(math.floor(hash.cellSize + 0.5)) .. "px",
    W.x + 12, W.y + 28
  )

  love.graphics.setColor(COLORS.muted[1], COLORS.muted[2], COLORS.muted[3], 0.4)
  love.graphics.rectangle("line", W.x, W.y, W.w, W.h)

  -- Legend: 2x2 where it fits, one column on narrow world views.
  local lx = W.x
  if W.w >= 470 then
    local y = W.y + W.h - 56
    draw.legendSwatch(lx + 16, y, COLORS.candidate, "Candidate pair (share a cell)", COLORS)
    draw.legendSwatch(lx + 16, y + 20, COLORS.hit, "Narrowphase confirmed hit", COLORS)
    draw.legendSwatch(lx + 280, y, COLORS.projA, "AABB body", COLORS)
    draw.legendSwatch(lx + 280, y + 20, COLORS.projB, "Circle body", COLORS)
  else
    local y = W.y + W.h - 96
    draw.legendSwatch(lx + 16, y, COLORS.candidate, "Candidate pair (share a cell)", COLORS)
    draw.legendSwatch(lx + 16, y + 20, COLORS.hit, "Narrowphase confirmed hit", COLORS)
    draw.legendSwatch(lx + 16, y + 40, COLORS.projA, "AABB body", COLORS)
    draw.legendSwatch(lx + 16, y + 60, COLORS.projB, "Circle body", COLORS)
  end
  if paused then
    love.graphics.setColor(COLORS.accent)
    -- clear of the field-notes button, which is bigger on touch screens
    love.graphics.print("PAUSED", W.x + W.w - (shell.isTouch() and 110 or 90), W.y + 12)
  end
end

--- Toolbar buttons press the same keys the keyboard shortcuts do (see lab.keypressed).
local function toolbarButtons()
  return {
    { label = "Narrowphase", key = "f2" },
    { label = "Boxes", key = "1", on = shapeSetIndex == 1 },
    { label = "Mixed", key = "2", on = shapeSetIndex == 2 },
    { label = "Notes", key = "f1" },
    { label = paused and "Play" or "Pause", key = "space", on = paused, row = true },
    { label = "Reset", key = "r" },
    { label = "Cell -", key = "[" },
    { label = "Cell +", key = "]" },
    { label = "Bodies -", key = "," },
    { label = "Bodies +", key = "." },
    { label = "Grid", key = "g", on = showGrid, row = true },
    { label = "Pairs", key = "c", on = showCandidates },
    { label = "Proxies", key = "p", on = showProxies },
  }
end

--- Panel text from the top down; returns the y below the last line.
--- keyHints: show keyboard shortcut lines (desktop).
local function drawInfo(px, y, wrap, keyHints)
  local font = love.graphics.getFont()
  local lineH = font:getHeight()

  local function printfAdvance(text, color, widthLimit)
    love.graphics.setColor(color)
    local _, lines = font:getWrap(text, widthLimit)
    love.graphics.printf(text, px, y, widthLimit)
    y = y + #lines * lineH + 4
  end

  love.graphics.setColor(COLORS.accent)
  love.graphics.print("Lab: Broadphase", px, y)
  y = y + lineH + 2
  if keyHints then
    love.graphics.setColor(COLORS.muted)
    love.graphics.print("F2  switch to Narrowphase", px, y)
    y = y + lineH + 8
  else
    y = y + 4
  end

  love.graphics.setColor(COLORS.accent)
  love.graphics.print("Uniform Grid / Spatial Hash", px, y)
  y = y + lineH + 4

  local set = currentSet()
  love.graphics.setColor(COLORS.text)
  love.graphics.print("Shape set: " .. set.name, px, y)
  y = y + lineH + 2
  printfAdvance(set.desc, COLORS.muted, wrap)
  y = y + 4

  love.graphics.setColor(COLORS.text)
  love.graphics.print("This frame", px, y)
  y = y + lineH + 4

  local rows = {
    { "Bodies", tostring(stats.n) },
    { "Brute-force pairs", string.format("%.0f", stats.brutePairs) },
    { "Broadphase candidates", tostring(stats.candidates) },
    { "Culled pairs", string.format("%.0f  (%.1f%%)", stats.culled, stats.cullPct) },
    { "Narrowphase hits", tostring(stats.hits) },
    { "Occupied cells", tostring(stats.occupiedCells) },
    { "Cell registrations", tostring(stats.registrations) },
    { "Raw cell pair checks", tostring(stats.cellPairChecks) },
    { "Cell size", string.format("%d px", math.floor(hash.cellSize + 0.5)) },
  }
  for _, row in ipairs(rows) do
    love.graphics.setColor(COLORS.muted)
    love.graphics.print(row[1], px, y)
    love.graphics.setColor(COLORS.text)
    love.graphics.printf(row[2], px, y, wrap, "right")
    y = y + lineH + 2
  end
  y = y + 6

  love.graphics.setColor(COLORS.muted)
  love.graphics.print("Pair reduction (candidates / brute)", px, y)
  y = y + lineH + 4
  local barW = wrap
  local barH = 10
  love.graphics.setColor(0.2, 0.22, 0.28)
  love.graphics.rectangle("fill", px, y, barW, barH, 2, 2)
  local frac = stats.brutePairs > 0 and (stats.candidates / stats.brutePairs) or 0
  frac = math.max(0, math.min(1, frac))
  love.graphics.setColor(COLORS.candidate)
  love.graphics.rectangle("fill", px, y, barW * frac, barH, 2, 2)
  y = y + barH + 8

  love.graphics.setColor(COLORS.text)
  love.graphics.print("Hits by narrowphase method", px, y)
  y = y + lineH + 4
  local methods = { "AABB-AABB", "AABB-circle", "circle-circle" }
  local anyMethod = false
  for _, m in ipairs(methods) do
    local c = methodCounts[m]
    if c and c > 0 then
      anyMethod = true
      love.graphics.setColor(COLORS.hit)
      love.graphics.print(string.format("  %s  x%d", m, c), px, y)
      y = y + lineH + 1
    end
  end
  if not anyMethod then
    love.graphics.setColor(COLORS.muted)
    love.graphics.print("  (none this frame)", px, y)
    y = y + lineH + 1
  end
  y = y + 8

  printfAdvance(
    "Yellow lines are false positives at the broadphase level: " ..
    "proxies shared a cell, but true shapes do not overlap. " ..
    "That is expected - broadphase must not miss real hits.",
    COLORS.muted,
    wrap
  )
  return y
end

local function drawPanel(L)
  local x, w = L.panel.x, L.panel.w
  local top, bottom = L.panel.y, L.panel.y + L.panel.h
  draw.panel(x, top, w, L.panel.h, COLORS)

  local px = x + 16
  local wrap = w - 32
  local font = love.graphics.getFont()
  local lineH = font:getHeight()

  -- Touch / small screens: toolbar on top, the rest scrolls underneath.
  if shell.showToolbar(L.w, L.h) then
    local used = shell.toolbar(L.panel, toolbarButtons(), COLORS)
    local view = { x = x, y = top + used, w = w, h = math.max(0, bottom - top - used) }
    panelView = view
    if panelScroll > panelMax then panelScroll = panelMax end
    draw.withScissor(view.x, view.y, view.w, view.h, function()
      local y0 = view.y + 4 - panelScroll
      local y = drawInfo(px, y0, wrap, false)
      panelMax = math.max(0, (y - y0) - view.h + 12)
    end)
    shell.scrollbar(view, panelScroll, panelMax, COLORS)
    return
  end
  panelView = nil

  local y = drawInfo(px, top + 14, wrap, true)

  local help = {
    "F2        switch lab",
    "1 / 2     AABB set / mixed set",
    "Q E Tab   prev / next set",
    "[ ]  - =  cell size",
    ", / .     fewer / more bodies",
    "Space     pause motion",
    "G C P     grid / candidates / proxies",
    "LMB drag  move body",
    "F1 / ?    field notes",
    "R reset   Esc quit",
  }
  local setBlock = (#SHAPE_SETS + 1) * (lineH + 2) + 10
  local helpBlock = (#help + 1) * (lineH + 1) + 12
  local footerTop = bottom - helpBlock - setBlock

  y = math.max(y + 6, footerTop)
  love.graphics.setColor(COLORS.text)
  love.graphics.print("Shape sets", px, y)
  y = y + lineH + 4
  for i, s in ipairs(SHAPE_SETS) do
    love.graphics.setColor(i == shapeSetIndex and COLORS.accent or COLORS.muted)
    love.graphics.print(string.format("%d  %s", i, s.name), px, y)
    y = y + lineH + 2
  end

  y = bottom - helpBlock
  love.graphics.setColor(COLORS.text)
  love.graphics.print("Controls", px, y)
  y = y + lineH + 4
  love.graphics.setColor(COLORS.muted)
  for _, line in ipairs(help) do
    love.graphics.print(line, px, y)
    y = y + lineH + 1
  end
end

function lab.draw()
  local L = layout()
  drawWorld(L)
  drawPanel(L)
  return L
end

function lab.mousepressed(x, y, button)
  if button ~= 1 then
    return false
  end
  local L = layout()
  if x < L.world.x or x >= L.world.x + L.world.w then return false end
  if y < L.world.y or y >= L.world.y + L.world.h then return false end

  local b = hitTest(x, y)
  selected = b
  if b then
    drag.active = true
    drag.ox = x - b.x
    drag.oy = y - b.y
  end
  return true
end

function lab.mousereleased()
  drag.active = false
end

function lab.mousemoved(x, y)
  if not drag.active or not selected then return end
  local L = layout()
  local bounds = playfield(L)
  selected.x = x - drag.ox
  selected.y = y - drag.oy
  shapes.clampToBounds(selected, bounds, 0)
  recomputeBroadphase()
end

function lab.wheelmoved(_wx, wy)
  if wy ~= 0 then
    hash:setCellSize(hash.cellSize + (wy > 0 and 8 or -8))
    recomputeBroadphase()
    return true
  end
  return false
end

--- Pinch changes the cell size in 8px steps (each ~15% change in finger spread is one step).
function lab.gesture(_dAngle, scale, _cx, _cy, g)
  g.pinch = (g.pinch or 1) * scale
  if g.pinch > 1.15 then
    hash:setCellSize(hash.cellSize + 8)
    g.pinch = 1
    recomputeBroadphase()
  elseif g.pinch < 1 / 1.15 then
    hash:setCellSize(hash.cellSize - 8)
    g.pinch = 1
    recomputeBroadphase()
  end
end

function lab.panelScrollHit(x, y)
  local v = panelView
  return v ~= nil and x >= v.x and x <= v.x + v.w and y >= v.y and y <= v.y + v.h
end

function lab.scrollPanel(dy)
  panelScroll = math.max(0, math.min(panelMax, panelScroll + dy))
end

local function setShapeSet(i)
  if i < 1 or i > #SHAPE_SETS then return end
  shapeSetIndex = i
  resetScene()
end

local function changeBodyCount(delta)
  bodyCount = math.max(4, math.min(120, bodyCount + delta))
  resetScene()
end

function lab.keypressed(key)
  if key == "r" then
    lab.reset()
    return true
  elseif key == "space" then
    paused = not paused
    return true
  elseif key == "g" then
    showGrid = not showGrid
    return true
  elseif key == "c" then
    showCandidates = not showCandidates
    return true
  elseif key == "p" then
    showProxies = not showProxies
    return true
  elseif key == "1" then
    setShapeSet(1)
    return true
  elseif key == "2" then
    setShapeSet(2)
    return true
  elseif key == "tab" or key == "e" then
    setShapeSet(shapeSetIndex % #SHAPE_SETS + 1)
    return true
  elseif key == "q" then
    setShapeSet((shapeSetIndex - 2) % #SHAPE_SETS + 1)
    return true
  elseif key == "]" or key == "=" or key == "+" or key == "kp+" then
    hash:setCellSize(hash.cellSize + 8)
    recomputeBroadphase()
    return true
  elseif key == "[" or key == "-" or key == "kp-" then
    hash:setCellSize(hash.cellSize - 8)
    recomputeBroadphase()
    return true
  elseif key == "," then
    changeBodyCount(-4)
    return true
  elseif key == "." then
    changeBodyCount(4)
    return true
  end
  return false
end

function lab.resize()
  local L = layout()
  local bounds = playfield(L)
  for _, b in ipairs(bodies) do
    shapes.clampToBounds(b, bounds, 0)
  end
  recomputeBroadphase()
end

return lab
