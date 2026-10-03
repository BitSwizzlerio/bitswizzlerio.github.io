--[[
  Educational help overlay for CollisionLab.
  Content depends on the active lab (narrowphase / broadphase).
  F1 / ? to open; Esc / X / click dim area to close. On touch: drag to scroll, tap outside to close.
  Blocks with a `touch` body show that text whenever the touch toolbar is up (no keyboard keys).
]]

local shell = require("shared.shell")

local help = {}

local open = false
local tab = 1
local scroll = 0
local maxScroll = 0
local labId = "narrow"

local btn = { x = 0, y = 0, r = 16 }
local closeBtn = { x = 0, y = 0, w = 28, h = 28 }
local tabRects = {}
local modal = { x = 0, y = 0, w = 0, h = 0 }
local content = { x = 0, y = 0, w = 0, h = 0 }

local CONTENT = {
  narrow = {
    tabs = { "Algorithms", "Shapes", "Labs & pipeline" },
    sections = {
      {
        blocks = {
          {
            h = "SAT  - Separating Axis Theorem",
            body =
              "Two convex shapes are separated if there exists an axis where their 1D " ..
              "projections do not overlap. Candidate axes are edge normals (plus special " ..
              "cases for circles). If every axis overlaps, they collide; the smallest " ..
              "overlap is a good MTV for resolution.",
          },
          {
            h = "GJK  - Gilbert-Johnson-Keerthi",
            body =
              "Work in Minkowski difference C = A - B. Shapes collide iff C contains the " ..
              "origin. GJK only needs support maps and builds a simplex that tries to " ..
              "enclose the origin. Does not report penetration depth by itself.",
          },
          {
            h = "MPR  - Minkowski Portal Refinement",
            body =
              "Also uses C = A - B. Cast a ray from an interior point v0 through the " ..
              "origin and refine a portal until hit or miss. Can estimate a contact " ..
              "normal and depth along the portal.",
          },
        },
      },
      {
        blocks = {
          {
            h = "Shape pairs (1..6)",
            body =
              "Ordered by teaching cost:\n" ..
              "  1  Circle vs circle\n" ..
              "  2  AABB vs AABB\n" ..
              "  3  AABB vs circle\n" ..
              "  4  OBB vs OBB\n" ..
              "  5  Circle vs polygon\n" ..
              "  6  Convex polygon vs polygon\n\n" ..
              "Only the active pair is drawn and tested.",
          },
          {
            h = "AABB lock (L)",
            body =
              "On a selected polygon, L forces axis-aligned mode (angle = 0). Useful to " ..
              "compare OBB cost vs AABB cost under SAT.",
            touch =
              "Select a polygon, then AABB lock forces axis-aligned mode (angle = 0). Useful to " ..
              "compare OBB cost vs AABB cost under SAT.",
          },
        },
      },
      {
        blocks = {
          {
            h = "CollisionLab modes",
            body =
              "This app has two labs:\n" ..
              "  Narrowphase (this lab) - exact tests on one pair (SAT/GJK/MPR).\n" ..
              "  Broadphase - cull many pairs with a spatial hash, then cheap bounds tests.\n\n" ..
              "Press F2 to switch. State of each lab is preserved while you are away.\n\n" ..
              "In a real game: broadphase candidates -> narrowphase (and maybe pixel masks).",
            touch =
              "This app has two labs:\n" ..
              "  Narrowphase (this lab) - exact tests on one pair (SAT/GJK/MPR).\n" ..
              "  Broadphase - cull many pairs with a spatial hash, then cheap bounds tests.\n\n" ..
              "The Broadphase button switches. State of each lab is preserved while you are away.\n\n" ..
              "In a real game: broadphase candidates -> narrowphase (and maybe pixel masks).",
          },
          {
            h = "Controls reminder",
            body =
              "S/G/M algorithms, 1-6 pairs, LMB move, RMB rotate, N/B step GJK/MPR, " ..
              "F1 help, F2 other lab, R reset, Esc quit.",
            touch =
              "Drag a shape to move it. Twist two fingers to rotate it, or switch on Rotate " ..
              "and drag. SAT / GJK / MPR pick the algorithm; < Pair and Pair > cycle the six " ..
              "pairs. In GJK and MPR, |< < Step Step > >| and Auto walk through the steps, " ..
              "and Witness shows the support points. Drag the info panel to scroll it.",
          },
        },
      },
    },
  },
  broad = {
    tabs = { "Broadphase", "Grid & hash", "Labs & pipeline" },
    sections = {
      {
        blocks = {
          {
            h = "Why broadphase exists",
            body =
              "Exact tests get expensive at scale. Broadphase uses cheap spatial structure " ..
              "to emit *candidate pairs* that might touch. Everything else is rejected " ..
              "without a full shape test. This lab uses a uniform grid / spatial hash - " ..
              "a common choice for 2D shmups and bullet storms.",
          },
          {
            h = "What you see",
            body =
              "Grid cells, occupancy tints, yellow candidate lines, green confirmed hits. " ..
              "Circles enter the hash through AABB proxies (toggle with P).",
            touch =
              "Grid cells, occupancy tints, yellow candidate lines, green confirmed hits. " ..
              "Circles enter the hash through AABB proxies (toggle with Proxies).",
          },
          {
            h = "Shape sets",
            body =
              "1  AABB vs AABB - all boxes, AABB-AABB narrowphase.\n" ..
              "2  AABB vs circle - mix; dispatches AABB-AABB, AABB-circle, circle-circle.",
          },
        },
      },
      {
        blocks = {
          {
            h = "Uniform grid / spatial hash",
            body =
              "Space is carved into equal cells. Each body inserts into every cell its " ..
              "AABB overlaps. Candidates = unique pairs that share a cell (deduped when " ..
              "bodies span multiple cells). Hash map storage means empty regions cost little.",
          },
          {
            h = "Cell size",
            body =
              "Rule of thumb: ~1x to 2x typical body diameter. Too small -> many registrations; " ..
              "too large -> candidates approach brute force. Tune with [ ] or mouse wheel.",
            touch =
              "Rule of thumb: ~1x to 2x typical body diameter. Too small -> many registrations; " ..
              "too large -> candidates approach brute force. Tune with Cell - / Cell +, or " ..
              "pinch with two fingers.",
          },
        },
      },
      {
        blocks = {
          {
            h = "CollisionLab modes",
            body =
              "Broadphase (this lab) answers: which pairs are worth testing?\n" ..
              "Narrowphase (F2) answers: do these two shapes really hit, and how?\n\n" ..
              "Pipeline story: spatial hash candidates -> AABB/circle tests -> optional " ..
              "texture opacity. Step 3 is not visualized here.",
            touch =
              "Broadphase (this lab) answers: which pairs are worth testing?\n" ..
              "Narrowphase (its button) answers: do these two shapes really hit, and how?\n\n" ..
              "Pipeline story: spatial hash candidates -> AABB/circle tests -> optional " ..
              "texture opacity. Step 3 is not visualized here.",
          },
          {
            h = "Controls reminder",
            body =
              "1/2 shape sets, [ ] cell size, ,/. body count, Space pause, G/C/P toggles, " ..
              "F1 help, F2 other lab, R reset, Esc quit.",
            touch =
              "Boxes / Mixed pick the shape set. Cell - / Cell + (or a pinch) resize the grid, " ..
              "Bodies - / Bodies + change the count, Pause freezes motion, and Grid / Pairs / " ..
              "Proxies toggle the overlays. Drag a body to move it; drag the info panel to scroll.",
          },
        },
      },
    },
  },
}

local function setColor(c, a)
  love.graphics.setColor(c[1], c[2], c[3], a or c[4] or 1)
end

local function pointInCircle(px, py, cx, cy, r)
  local dx, dy = px - cx, py - cy
  return dx * dx + dy * dy <= r * r
end

local function pointInRect(px, py, r)
  return px >= r.x and px <= r.x + r.w and py >= r.y and py <= r.y + r.h
end

local function pack()
  return CONTENT[labId] or CONTENT.narrow
end

local function bodyOf(block)
  return (shell.showToolbar() and block.touch) or block.body
end

function help.setLab(id)
  if labId ~= id then
    labId = id
    tab = 1
    scroll = 0
  end
end

function help.isOpen()
  return open
end

function help.toggle()
  open = not open
  if open then
    scroll = 0
  end
end

function help.close()
  open = false
end

function help.layoutButton(world)
  btn.r = shell.isTouch() and 22 or 16
  btn.x = world.x + world.w - (btn.r + 12)
  btn.y = world.y + btn.r + 12
end

function help.drawButton(COLORS)
  setColor(COLORS.panel, 0.92)
  love.graphics.circle("fill", btn.x, btn.y, btn.r)
  setColor(COLORS.accent, 0.95)
  love.graphics.setLineWidth(2)
  love.graphics.circle("line", btn.x, btn.y, btn.r)
  setColor(COLORS.text)
  local font = love.graphics.getFont()
  local q = "?"
  love.graphics.print(q, btn.x - font:getWidth(q) * 0.5, btn.y - font:getHeight() * 0.5)
  love.graphics.setLineWidth(1.5)
end

local function measureContentHeight(font, wrapW)
  local lineH = font:getHeight()
  local y = 0
  local section = pack().sections[tab]
  for _, block in ipairs(section.blocks) do
    y = y + lineH + 6
    local _, lines = font:getWrap(bodyOf(block), wrapW)
    y = y + #lines * lineH + 16
  end
  return y
end

function help.draw(COLORS, L)
  local screenW, screenH = L.w, L.h
  local compact = shell.isCompact(screenW, screenH)
  local touch = shell.isTouch()
  help.layoutButton(L.region or L.world)
  help.drawButton(COLORS)
  if not open then return end

  local data = pack()
  local TABS = data.tabs

  setColor({ 0, 0, 0 }, 0.62)
  love.graphics.rectangle("fill", 0, 0, screenW, screenH)

  local mw = math.min(720, screenW - (compact and 20 or 80))
  local mh = math.min(560, screenH - (compact and 20 or 60))
  local mx = (screenW - mw) * 0.5
  local my = (screenH - mh) * 0.5
  modal.x, modal.y, modal.w, modal.h = mx, my, mw, mh

  setColor(COLORS.panel, 0.98)
  love.graphics.rectangle("fill", mx, my, mw, mh, 6, 6)
  setColor(COLORS.accent, 0.55)
  love.graphics.setLineWidth(2)
  love.graphics.rectangle("line", mx, my, mw, mh, 6, 6)
  love.graphics.setLineWidth(1.5)

  local font = love.graphics.getFont()
  local lineH = font:getHeight()
  local pad = 18

  setColor(COLORS.accent)
  local labName = labId == "broad" and "Broadphase" or "Narrowphase"
  love.graphics.print("CollisionLab  -  " .. labName .. " field notes", mx + pad, my + 14)
  setColor(COLORS.muted)
  love.graphics.print(touch and "Tap X or outside to close  |  drag to scroll"
    or "F2 switches labs  |  Esc or X to close  |  wheel to scroll", mx + pad, my + 14 + lineH + 2)

  if touch then
    closeBtn.w, closeBtn.h = 44, 40
  else
    closeBtn.w, closeBtn.h = 30, 28
  end
  closeBtn.x = mx + mw - closeBtn.w - 12
  closeBtn.y = my + 12
  setColor(COLORS.muted, 0.35)
  love.graphics.rectangle("fill", closeBtn.x, closeBtn.y, closeBtn.w, closeBtn.h, 3, 3)
  setColor(COLORS.text)
  local xw = font:getWidth("X")
  love.graphics.print("X", closeBtn.x + (closeBtn.w - xw) * 0.5, closeBtn.y + (closeBtn.h - lineH) * 0.5)

  tabRects = {}
  local tabY = my + 14 + lineH * 2 + 16
  local tx = mx + pad
  local tabH = touch and (lineH + 18) or (lineH + 10)
  for i, name in ipairs(TABS) do
    local tw = font:getWidth(name) + 20
    if tx + tw > mx + mw - pad and tx > mx + pad then
      tx = mx + pad
      tabY = tabY + tabH + 6
    end
    local tr = { x = tx, y = tabY, w = tw, h = tabH, index = i }
    tabRects[i] = tr
    if i == tab then
      setColor(COLORS.accent, 0.25)
      love.graphics.rectangle("fill", tr.x, tr.y, tr.w, tr.h, 3, 3)
      setColor(COLORS.accent)
    else
      setColor(COLORS.muted, 0.2)
      love.graphics.rectangle("fill", tr.x, tr.y, tr.w, tr.h, 3, 3)
      setColor(COLORS.muted)
    end
    love.graphics.print(name, tr.x + 10, tr.y + (tabH - lineH) * 0.5)
    tx = tx + tw + 8
  end

  local cy = tabY + tabH + 8
  content.x = mx + pad
  content.y = cy
  content.w = mw - pad * 2
  content.h = my + mh - cy - pad

  local wrapW = content.w - 8
  local totalH = measureContentHeight(font, wrapW)
  maxScroll = math.max(0, totalH - content.h)
  if scroll > maxScroll then scroll = maxScroll end
  if scroll < 0 then scroll = 0 end

  local sx, sy, sw, sh = love.graphics.getScissor()
  love.graphics.setScissor(content.x, content.y, content.w, content.h)

  local y = content.y - scroll
  local section = data.sections[tab]
  for _, block in ipairs(section.blocks) do
    setColor(COLORS.hit)
    love.graphics.print(block.h, content.x, y)
    y = y + lineH + 6
    setColor(COLORS.text)
    love.graphics.printf(bodyOf(block), content.x, y, wrapW)
    local _, lines = font:getWrap(bodyOf(block), wrapW)
    y = y + #lines * lineH + 16
  end

  if sx then
    love.graphics.setScissor(sx, sy, sw, sh)
  else
    love.graphics.setScissor()
  end

  if maxScroll > 0 then
    local barH = math.max(24, content.h * content.h / (totalH + content.h * 0.01))
    local t = maxScroll > 0 and (scroll / maxScroll) or 0
    local barY = content.y + t * (content.h - barH)
    setColor(COLORS.muted, 0.35)
    love.graphics.rectangle("fill", content.x + content.w - 4, content.y, 3, content.h, 1, 1)
    setColor(COLORS.accent, 0.7)
    love.graphics.rectangle("fill", content.x + content.w - 4, barY, 3, barH, 1, 1)
  end
end

function help.mousepressed(x, y, button)
  if button ~= 1 then
    return open
  end
  if pointInCircle(x, y, btn.x, btn.y, btn.r + 2) then
    help.toggle()
    return true
  end
  if not open then return false end
  if pointInRect(x, y, closeBtn) then
    help.close()
    return true
  end
  for _, tr in ipairs(tabRects) do
    if pointInRect(x, y, tr) then
      tab = tr.index
      scroll = 0
      return true
    end
  end
  if pointInRect(x, y, modal) then
    return true
  end
  help.close()
  return true
end

function help.scrollBy(dy)
  scroll = math.max(0, math.min(maxScroll, scroll + dy))
end

function help.wheelmoved(_wx, wy)
  if not open then return false end
  scroll = scroll - wy * 36
  if scroll < 0 then scroll = 0 end
  if scroll > maxScroll then scroll = maxScroll end
  return true
end

function help.keypressed(key)
  if key == "f1" or key == "?" or key == "/" then
    help.toggle()
    return true
  end
  if not open then return false end
  if key == "escape" then
    help.close()
    return true
  end
  local nTabs = #pack().tabs
  if key == "left" then
    tab = tab - 1
    if tab < 1 then tab = nTabs end
    scroll = 0
    return true
  end
  if key == "right" then
    tab = tab + 1
    if tab > nTabs then tab = 1 end
    scroll = 0
    return true
  end
  if key == "up" or key == "pageup" then
    scroll = math.max(0, scroll - 48)
    return true
  end
  if key == "down" or key == "pagedown" then
    scroll = math.min(maxScroll, scroll + 48)
    return true
  end
  if key == "home" then
    scroll = 0
    return true
  end
  if key == "end" then
    scroll = maxScroll
    return true
  end
  return true
end

return help
