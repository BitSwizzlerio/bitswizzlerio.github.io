--[[
  Narrowphase lab mode: SAT + GJK + MPR on one active shape pair.
  Module API for the CollisionLab shell.
]]

local shapes = require("narrowphase.shapes")
local sat = require("narrowphase.sat")
local gjk = require("narrowphase.gjk")
local mpr = require("narrowphase.mpr")
local drawsat = require("narrowphase.draw_sat")
local drawc = require("narrowphase.draw_common")
local drawm = require("narrowphase.draw_minkowski")
local drawgjk = require("narrowphase.draw_gjk")
local drawmpr = require("narrowphase.draw_mpr")
local shell = require("shared.shell")

local lab = {}

local COLORS
local pairsList = {}
local activePair = 1
local algo = "sat"
local result = nil
local stepIndex = 1
local selected = nil
local drag = { mode = nil, ox = 0, oy = 0 }
local autoPlay = false
local autoTimer = 0
local autoInterval = 0.55
local showWitnesses = true
local dirty = true
local entered = false
local rotateMode = false          -- toolbar toggle: a primary drag rotates instead of moving
local panelScroll, panelMax = 0, 0
local panelView = nil             -- scrollable info area (toolbar layouts only)

-- Region holding every pair's starting shapes, with room to drag. Small world views are fitted
-- to it; the desktop view keeps shapes at their absolute positions, as it always has.
local ROI = { x = 70, y = 225, w = 320, h = 195 }

local MODE_LABELS = {
  sat = "SAT  (Separating Axis Theorem)",
  gjk = "GJK  (Gilbert-Johnson-Keerthi)",
  mpr = "MPR  (Minkowski Portal Refinement)",
}

local function makeScene()
  pairsList = {
    {
      name = "Circle vs circle",
      desc = "Simplest case. SAT: one axis (line of centers). GJK/MPR: disk C at cA-cB.",
      a = shapes.circle(170, 300, 48, "A"),
      b = shapes.circle(300, 340, 58, "B"),
    },
    {
      name = "AABB vs AABB",
      desc = "Both axis-locked. SAT projects on world X/Y only (two axes).",
      a = shapes.rect(160, 280, 100, 70, 0, true, "A"),
      b = shapes.rect(300, 310, 90, 90, 0, true, "B"),
    },
    {
      name = "AABB vs circle",
      desc = "SAT: box normals + closest-point axis. GJK/MPR: support maps.",
      a = shapes.rect(160, 300, 110, 80, 0, true, "A"),
      b = shapes.circle(310, 320, 50, "B"),
    },
    {
      name = "OBB vs OBB",
      desc = "Rotated boxes. SAT uses up to four edge normals.",
      a = shapes.rect(150, 270, 110, 70, math.rad(25), false, "A"),
      b = shapes.rect(300, 310, 100, 80, math.rad(-35), false, "B"),
    },
    {
      name = "Circle vs polygon",
      desc = "Circle support = center + r * unit(d). SAT: poly edges + closest-point axis.",
      a = shapes.circle(160, 300, 52, "A"),
      b = shapes.regular(310, 320, 6, 65, math.rad(20), "B"),
    },
    {
      name = "Convex polygons",
      desc = "Most general. SAT tests all edge normals from both shapes.",
      a = shapes.regular(155, 300, 5, 70, math.rad(10), "A"),
      b = shapes.polygon(
        310, 320,
        { { 0, -60 }, { 55, -20 }, { 40, 50 }, { -45, 45 }, { -60, -10 } },
        math.rad(-15),
        "B"
      ),
    },
  }
  activePair = 1
  selected = nil
  dirty = true
end

local function currentPair()
  return pairsList[activePair]
end

local function isIterativeMode()
  return algo == "gjk" or algo == "mpr"
end

local function recompute()
  local p = currentPair()
  if algo == "sat" then
    result = sat.test(p.a, p.b)
    stepIndex = 1
  elseif algo == "gjk" then
    result = gjk.test(p.a, p.b)
    stepIndex = #result.steps
  else
    result = mpr.test(p.a, p.b)
    stepIndex = #result.steps
  end
  dirty = false
end

local function ensureResult()
  if dirty or not result then
    recompute()
  end
end

local function currentStep()
  if not isIterativeMode() then return nil end
  ensureResult()
  if not result or not result.steps or #result.steps == 0 then return nil end
  stepIndex = math.max(1, math.min(stepIndex, #result.steps))
  return result.steps[stepIndex]
end

local function setAlgo(newMode)
  if algo == newMode then return end
  algo = newMode
  autoPlay = false
  dirty = true
end

local function setPair(i)
  if i < 1 or i > #pairsList then return end
  activePair = i
  selected = nil
  autoPlay = false
  dirty = true
end

local function hitTest(x, y)
  local p = currentPair()
  if shapes.pointIn(p.b, x, y) then return p.b end
  if shapes.pointIn(p.a, x, y) then return p.a end
  return nil
end

-- SAT rails sit top-left of the world view: on desktop they run down to the legend, on small
-- screens they keep to the top ~40% so the shapes stay visible.
local function railsMaxY(L)
  if L.mode == "wide" then return L.world.y + L.world.h - 70 end
  return L.world.y + math.floor(L.world.h * 0.42)
end

local function railsBottom(L)
  ensureResult()
  local n = #(result.axes or {})
  local y0, maxY = L.world.y + 78, railsMaxY(L)
  local k = 0
  while k < n and y0 + k * 28 + 28 <= maxY do k = k + 1 end
  if k < n then return y0 + k * 28 + 12 end
  return y0 + math.max(0, n - 1) * 28 + 26
end

--- Screen transform for world-space drawing: identity when the view holds the shapes at their
--- absolute positions (desktop at 1280+), otherwise fitted to the view (phones, tablets, narrow
--- windows, where GJK/MPR's half-width world used to cut shape B off).
local function worldCamera(L)
  if L.mode == "wide" and L.world.w >= 460 then return { s = 1, tx = 0, ty = 0 } end
  local r = L.world
  local top = (algo == "sat") and (railsBottom(L) - r.y + 6) or 46
  local bottom = (algo ~= "sat") and 10 or (r.w >= 370 and 56 or 96)   -- SAT legend: 2 or 4 rows
  local fw, fh = r.w - 16, math.max(40, r.h - top - bottom)
  local s = math.min(1.25, fw / ROI.w, fh / ROI.h)
  return {
    s = s,
    tx = r.x + 8 + (fw - ROI.w * s) / 2 - ROI.x * s,
    ty = r.y + top + (fh - ROI.h * s) / 2 - ROI.y * s,
  }
end

local function layout()
  local R = shell.regions()
  local L = { mode = R.mode, w = R.w, h = R.h, panelW = R.panelW, panel = R.panel, region = R.world }
  local W = R.world
  if algo == "sat" then
    L.world = W
  elseif R.mode == "portrait" then
    local half = math.floor(W.h * 0.5)
    L.world = { x = W.x, y = W.y, w = W.w, h = half }
    L.mink = { x = W.x, y = W.y + half, w = W.w, h = W.h - half }
  else
    local worldW = W.w * 0.50
    L.world = { x = W.x, y = W.y, w = worldW, h = W.h }
    L.mink = { x = W.x + worldW, y = W.y, w = W.w - worldW, h = W.h }
  end
  L.cam = worldCamera(L)
  return L
end

local function toWorld(L, x, y)
  return (x - L.cam.tx) / L.cam.s, (y - L.cam.ty) / L.cam.s
end

--- The world-space rectangle visible in the world view.
local function worldBounds(L)
  local r, c = L.world, L.cam
  return (r.x - c.tx) / c.s, (r.y - c.ty) / c.s, (r.x + r.w - c.tx) / c.s, (r.y + r.h - c.ty) / c.s
end

function lab.id()
  return "narrow"
end

function lab.title()
  return "Narrowphase  -  SAT / GJK / MPR"
end

function lab.enter(colors)
  COLORS = colors
  if not entered then
    makeScene()
    entered = true
  end
  autoPlay = false
  drag.mode = nil
end

function lab.reset()
  makeScene()
  autoPlay = false
end

function lab.update(dt)
  if autoPlay and isIterativeMode() then
    autoTimer = autoTimer + dt
    if autoTimer >= autoInterval then
      autoTimer = 0
      ensureResult()
      if stepIndex < #result.steps then
        stepIndex = stepIndex + 1
      else
        autoPlay = false
      end
    end
  end
end

local function drawWorld(L)
  local p = currentPair()
  local step = currentStep()
  local W = L.world

  drawc.withScissor(W.x, W.y, W.w, W.h, function()
    love.graphics.setColor(0.10, 0.11, 0.14)
    love.graphics.rectangle("fill", W.x, W.y, W.w, W.h)

    love.graphics.push()
    love.graphics.translate(L.cam.tx, L.cam.ty)
    love.graphics.scale(L.cam.s)
    if algo == "sat" then
      drawsat.shape(p.a, true, COLORS)
      drawsat.shape(p.b, true, COLORS)
      ensureResult()
      drawsat.axes(p.a, p.b, result, COLORS, worldBounds(L))
      if selected then
        drawsat.selection(selected, COLORS)
      end
    else
      drawc.shape(p.a, COLORS, { highlight = true, isA = true })
      drawc.shape(p.b, COLORS, { highlight = true, isA = false })
      if selected then
        drawc.selection(selected, COLORS)
      end
      if showWitnesses then
        if algo == "gjk" then
          drawgjk.worldHints(step, p.a, p.b, COLORS)
        else
          drawmpr.worldHints(step, result, p.a, p.b, COLORS)
        end
      end
    end
    love.graphics.pop()

    if algo == "sat" then
      drawsat.rails(result, COLORS, W, railsMaxY(L))
    end
  end)

  love.graphics.setColor(COLORS.text)
  love.graphics.print("World space  -  narrowphase", W.x + 12, W.y + 10)
  love.graphics.setColor(COLORS.muted)
  love.graphics.print(p.name, W.x + 12, W.y + 28)

  love.graphics.setColor(COLORS.muted[1], COLORS.muted[2], COLORS.muted[3], 0.4)
  love.graphics.rectangle("line", W.x, W.y, W.w, W.h)

  if algo == "sat" then
    -- 2x2 where it fits, one column on narrow phones
    ensureResult()
    local items = {
      { COLORS.projA, "Shape A projection" },
      { COLORS.projB, "Shape B projection" },
      { COLORS.axis, "Test axis (normal)" },
      { result.colliding and COLORS.hit or COLORS.miss, result.colliding and "All axes overlap" or "Separating axis found" },
    }
    local lx, ly = W.x, W.y + W.h
    for i, it in ipairs(items) do
      local x, y
      if W.w >= 370 then
        x, y = lx + (i <= 2 and 16 or 200), ly - (i % 2 == 1 and 52 or 32)
      else
        x, y = lx + 16, ly - 92 + (i - 1) * 20
      end
      love.graphics.setColor(it[1])
      love.graphics.rectangle("fill", x, y, 14, 14)
      love.graphics.setColor(COLORS.text)
      love.graphics.print(it[2], x + 20, y)
    end
  end
end

local function drawMinkowski(L)
  if not L.mink then return end
  local p = currentPair()
  local step = currentStep()
  drawm.viewport(p.a, p.b, L.mink, COLORS, function(cam, cols)
    if algo == "gjk" then
      drawgjk.overlay(step, cam, cols)
    else
      drawmpr.overlay(step, cam, cols)
    end
  end)
end

--- Toolbar buttons press the same keys the keyboard shortcuts do (see lab.keypressed).
local function toolbarButtons()
  local canLock = selected ~= nil and not selected:isCircle()
  local list = {
    { label = "Broadphase", key = "f2" },
    { label = "SAT", key = "s", on = algo == "sat" },
    { label = "GJK", key = "g", on = algo == "gjk" },
    { label = "MPR", key = "m", on = algo == "mpr" },
    { label = "Notes", key = "f1" },
    { label = "< Pair", key = "q", row = true },
    { label = "Pair >", key = "e" },
    { label = "Rotate", action = function() rotateMode = not rotateMode end, on = rotateMode },
    { label = "AABB lock", key = "l", enabled = canLock, on = canLock and selected.axisAligned },
    { label = "Reset", key = "r" },
  }
  if isIterativeMode() then
    local steps = {
      { label = "|<", key = "home", row = true },
      { label = "< Step", key = "b" },
      { label = "Step >", key = "n" },
      { label = ">|", key = "end" },
      { label = "Auto", key = "a", on = autoPlay },
      { label = "Witness", key = "t", on = showWitnesses },
    }
    for _, b in ipairs(steps) do list[#list + 1] = b end
  end
  return list
end

--- Panel text from the top down; returns the y below the last line.
--- keyHints: show keyboard shortcut lines (desktop). detailsMaxY: where details must stop.
local function drawInfo(px, y, wrap, keyHints, detailsMaxY)
  local font = love.graphics.getFont()
  local lineH = font:getHeight()

  local function printfAdvance(text, color, widthLimit)
    love.graphics.setColor(color)
    local _, lines = font:getWrap(text, widthLimit)
    love.graphics.printf(text, px, y, widthLimit)
    y = y + #lines * lineH + 4
  end

  love.graphics.setColor(COLORS.accent)
  love.graphics.print("Lab: Narrowphase", px, y)
  y = y + lineH + 2
  if keyHints then
    love.graphics.setColor(COLORS.muted)
    love.graphics.print("F2  switch to Broadphase", px, y)
    y = y + lineH + 8
  else
    y = y + 4
  end

  love.graphics.setColor(COLORS.accent)
  love.graphics.print(MODE_LABELS[algo], px, y)
  y = y + lineH + 4

  if keyHints then
    love.graphics.setColor(COLORS.muted)
    love.graphics.print("Algorithm:  [S] SAT   [G] GJK   [M] MPR", px, y)
    y = y + lineH + 8
  end

  local blurbs = {
    sat = "Projects both shapes onto candidate axes (edge normals, etc.). Separated if any axis has a gap.",
    gjk = "Builds a simplex in C = A - B that tries to enclose the origin. Support points only.",
    mpr = "Ray from interior point v0 through the origin; refines a portal (edge) until hit or miss.",
  }
  printfAdvance(blurbs[algo], COLORS.muted, wrap)
  y = y + 2

  ensureResult()
  local colliding = result.colliding
  love.graphics.setColor(colliding and COLORS.hit or COLORS.miss)
  love.graphics.print(colliding and "RESULT: COLLIDING" or "RESULT: SEPARATED", px, y)
  y = y + lineH + 4

  local p = currentPair()
  love.graphics.setColor(COLORS.text)
  if keyHints then
    love.graphics.print("Pair: " .. p.name, px, y)
  else
    love.graphics.print(string.format("Pair %d/%d: %s", activePair, #pairsList, p.name), px, y)
  end
  y = y + lineH + 2
  printfAdvance(p.desc, COLORS.muted, wrap)

  if algo == "sat" then
    if result.mtv then
      love.graphics.setColor(COLORS.accent)
      love.graphics.print(
        string.format("MTV: (%.2f, %.2f)  depth=%.2f", result.mtv.x, result.mtv.y, result.depth),
        px, y
      )
      y = y + lineH + 4
    elseif result.sepAxis then
      love.graphics.setColor(COLORS.muted)
      love.graphics.print(
        string.format("Separating axis: (%.2f, %.2f)", result.sepAxis.x, result.sepAxis.y),
        px, y
      )
      y = y + lineH + 4
    end

    love.graphics.setColor(COLORS.text)
    love.graphics.print("Axes (active pair only)", px, y)
    y = y + lineH + 4

    for i, ax in ipairs(result.axes or {}) do
      if y + lineH * 3 > detailsMaxY then
        love.graphics.setColor(COLORS.muted)
        love.graphics.print("... more axes in world rails", px, y)
        y = y + lineH
        break
      end
      local ok = ax.overlap
      love.graphics.setColor(ok and COLORS.hit or COLORS.miss)
      love.graphics.print(
        string.format("#%d  n=(%+.2f,%+.2f)  %s  o=%.1f",
          i, ax.nx, ax.ny, ok and "OVERLAP" or "GAP", ax.overlapAmount),
        px, y
      )
      y = y + lineH
      love.graphics.setColor(COLORS.projA)
      love.graphics.print(string.format("    A [%.1f .. %.1f]", ax.aMin, ax.aMax), px, y)
      y = y + lineH - 2
      love.graphics.setColor(COLORS.projB)
      love.graphics.print(string.format("    B [%.1f .. %.1f]", ax.bMin, ax.bMax), px, y)
      y = y + lineH + 2
    end
  else
    if algo == "mpr" and result.colliding and result.depth ~= nil then
      love.graphics.setColor(COLORS.accent)
      love.graphics.print(
        string.format("~ depth %.2f   n=(%+.2f, %+.2f)",
          result.depth,
          result.normal and result.normal.x or 0,
          result.normal and result.normal.y or 0),
        px, y
      )
      y = y + lineH + 2
    end

    love.graphics.setColor(COLORS.text)
    love.graphics.print(
      string.format("Step %d / %d   (iters: %s)",
        stepIndex, result.steps and #result.steps or 0, tostring(result.iterations or "?")),
      px, y
    )
    y = y + lineH + 6

    local barW = wrap
    local barH = 8
    love.graphics.setColor(0.2, 0.22, 0.28)
    love.graphics.rectangle("fill", px, y, barW, barH, 2, 2)
    local nSteps = result.steps and #result.steps or 0
    local frac = nSteps > 0 and (stepIndex / nSteps) or 0
    love.graphics.setColor(COLORS.accent)
    love.graphics.rectangle("fill", px, y, barW * frac, barH, 2, 2)
    y = y + barH + 10

    local step = currentStep()
    if step and y < detailsMaxY then
      love.graphics.setColor(COLORS.axis)
      love.graphics.print("Phase: " .. tostring(step.phase or "?"), px, y)
      y = y + lineH + 2
      if y < detailsMaxY and step.region then
        printfAdvance("Region: " .. step.region, COLORS.text, wrap)
      end
      if y < detailsMaxY and step.note and step.note ~= "" then
        printfAdvance(step.note, COLORS.muted, wrap)
      end
      if y < detailsMaxY and step.dir then
        love.graphics.setColor(COLORS.axis)
        love.graphics.print(string.format("dir  (%.3f, %.3f)", step.dir.x, step.dir.y), px, y)
        y = y + lineH
      end
      if y < detailsMaxY and step.normal and not step.dir then
        love.graphics.setColor(COLORS.axis)
        love.graphics.print(string.format("n  (%.3f, %.3f)", step.normal.x, step.normal.y), px, y)
        y = y + lineH
      end
      if y < detailsMaxY and step.support then
        love.graphics.setColor(COLORS.support)
        love.graphics.print(
          string.format("support  (%.2f, %.2f)", step.support.x, step.support.y), px, y)
        y = y + lineH
      end
      if y < detailsMaxY and algo == "gjk" and step.simplex then
        love.graphics.setColor(COLORS.simplexEdge)
        love.graphics.print(string.format("simplex size: %d", #step.simplex), px, y)
        y = y + lineH
      end
      if y < detailsMaxY and algo == "mpr" and step.v0 then
        love.graphics.setColor(COLORS.v0)
        love.graphics.print(string.format("v0  (%.2f, %.2f)", step.v0.x, step.v0.y), px, y)
        y = y + lineH
      end
    end
  end
  return y
end

local function drawPanel(L)
  local x, w = L.panel.x, L.panel.w
  local top, bottom = L.panel.y, L.panel.y + L.panel.h
  drawc.panel(x, top, w, L.panel.h, COLORS)

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
    drawc.withScissor(view.x, view.y, view.w, view.h, function()
      local y0 = view.y + 4 - panelScroll
      local y = drawInfo(px, y0, wrap, false, math.huge)
      panelMax = math.max(0, (y - y0) - view.h + 12)
    end)
    shell.scrollbar(view, panelScroll, panelMax, COLORS)
    return
  end
  panelView = nil

  local help
  if algo == "sat" then
    help = {
      "F2        switch lab",
      "S/G/M     SAT / GJK / MPR",
      "1-6       select pair",
      "Q/E Tab   prev / next pair",
      "LMB drag  move shape",
      "RMB drag  rotate (if free)",
      "L         toggle AABB lock",
      "F1 / ?    field notes",
      "R reset   Esc quit",
    }
  else
    help = {
      "F2        switch lab",
      "S/G/M     SAT / GJK / MPR",
      "1-6       select pair",
      "Q/E Tab   prev / next pair",
      "LMB/RMB   move / rotate",
      "N/Space   step forward",
      "B         step back",
      "A         auto-play steps",
      "Home/End  first / last",
      "T         toggle witnesses",
      "F1 / ?    field notes",
      "R reset   Esc quit",
    }
  end

  local helpBlock = (#help + 1) * (lineH + 1) + 8 + (autoPlay and 20 or 8)
  local pairBlock = (#pairsList + 1) * (lineH + 2) + 18
  local footerTop = bottom - helpBlock - pairBlock

  drawInfo(px, top + 14, wrap, true, footerTop - 8)

  local y = footerTop
  love.graphics.setColor(COLORS.text)
  love.graphics.print("Shape pairs (only active is shown)", px, y)
  y = y + lineH + 4
  for i, pair in ipairs(pairsList) do
    local isActive = (i == activePair)
    love.graphics.setColor(isActive and COLORS.accent or COLORS.muted)
    love.graphics.print(string.format("%d  %s", i, pair.name), px, y)
    y = y + lineH + 2
  end

  y = math.max(y + 10, bottom - helpBlock)
  love.graphics.setColor(COLORS.text)
  love.graphics.print("Controls", px, y)
  y = y + lineH + 4
  love.graphics.setColor(COLORS.muted)
  for _, line in ipairs(help) do
    love.graphics.print(line, px, y)
    y = y + lineH + 1
  end

  if autoPlay and isIterativeMode() then
    love.graphics.setColor(COLORS.accent)
    love.graphics.print("AUTO-PLAY", px, bottom - lineH - 8)
  end
end

function lab.draw()
  ensureResult()
  local L = layout()
  drawWorld(L)
  drawMinkowski(L)
  drawPanel(L)
  return L
end

function lab.mousepressed(x, y, button)
  local L = layout()
  if x < L.world.x or x >= L.world.x + L.world.w then return false end
  if y < L.world.y or y >= L.world.y + L.world.h then return false end

  if button == 1 and rotateMode then button = 2 end
  local wx, wy = toWorld(L, x, y)
  local s = hitTest(wx, wy)
  if not s then
    selected = nil
    return true
  end
  selected = s
  if button == 1 then
    drag.mode = "move"
    drag.ox = wx - s.x
    drag.oy = wy - s.y
  elseif button == 2 and not s:isCircle() and not s.axisAligned then
    drag.mode = "rotate"
    drag.angle0 = s.angle
    drag.ox = wx
    drag.oy = wy
    drag.cx = s.x
    drag.cy = s.y
  end
  return true
end

function lab.mousereleased()
  drag.mode = nil
end

function lab.mousemoved(x, y)
  if not selected or not drag.mode then return end
  local L = layout()
  local wx, wy = toWorld(L, x, y)
  local x0, y0, x1, y1 = worldBounds(L)
  local margin = 20 / L.cam.s
  local minX, maxX = x0 + margin, x1 - margin
  local minY, maxY = y0 + margin, y1 - margin

  if drag.mode == "move" then
    selected.x = math.max(minX, math.min(maxX, wx - drag.ox))
    selected.y = math.max(minY, math.min(maxY, wy - drag.oy))
    dirty = true
  elseif drag.mode == "rotate" then
    local a0 = math.atan2(drag.oy - drag.cy, drag.ox - drag.cx)
    local a1 = math.atan2(wy - drag.cy, wx - drag.cx)
    selected.angle = drag.angle0 + (a1 - a0)
    dirty = true
  end
end

function lab.wheelmoved(_wx, _wy)
  return false
end

--- Two-finger twist rotates the selected shape (if it is free to rotate).
function lab.gesture(dAngle)
  if selected and not selected:isCircle() and not selected.axisAligned then
    selected.angle = selected.angle + dAngle
    dirty = true
  end
end

function lab.panelScrollHit(x, y)
  local v = panelView
  return v ~= nil and x >= v.x and x <= v.x + v.w and y >= v.y and y <= v.y + v.h
end

function lab.scrollPanel(dy)
  panelScroll = math.max(0, math.min(panelMax, panelScroll + dy))
end

function lab.keypressed(key)
  if key == "r" then
    lab.reset()
    return true
  elseif key == "s" then
    setAlgo("sat")
    return true
  elseif key == "g" then
    setAlgo("gjk")
    return true
  elseif key == "m" then
    setAlgo("mpr")
    return true
  elseif key == "tab" or key == "e" then
    setPair(activePair % #pairsList + 1)
    return true
  elseif key == "q" then
    setPair((activePair - 2) % #pairsList + 1)
    return true
  elseif key == "l" and selected and not selected:isCircle() then
    selected.axisAligned = not selected.axisAligned
    if selected.axisAligned then
      selected.angle = 0
    end
    dirty = true
    return true
  elseif key == "t" then
    showWitnesses = not showWitnesses
    return true
  elseif key == "space" then
    if isIterativeMode() then
      ensureResult()
      stepIndex = math.min(#result.steps, stepIndex + 1)
      autoPlay = false
    else
      setPair(activePair % #pairsList + 1)
    end
    return true
  elseif isIterativeMode() and key == "n" then
    ensureResult()
    stepIndex = math.min(#result.steps, stepIndex + 1)
    autoPlay = false
    return true
  elseif isIterativeMode() and (key == "b" or key == "backspace") then
    stepIndex = math.max(1, stepIndex - 1)
    autoPlay = false
    return true
  elseif isIterativeMode() and key == "a" then
    autoPlay = not autoPlay
    autoTimer = 0
    return true
  elseif isIterativeMode() and key == "home" then
    stepIndex = 1
    autoPlay = false
    return true
  elseif isIterativeMode() and key == "end" then
    ensureResult()
    stepIndex = #result.steps
    autoPlay = false
    return true
  else
    local n = tonumber(key)
    if n and n >= 1 and n <= #pairsList then
      setPair(n)
      return true
    end
  end
  return false
end

function lab.resize()
  -- nothing special: shapes stay in world coords and the camera refits each frame
end

return lab
