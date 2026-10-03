--[[
  Shared UI shell for both labs: screen regions, the touch toolbar, and panel scrolling.

  Regions
    wide       w >= 1000 and h >= 600   world left, 360px info panel right (the desktop layout)
    landscape  smaller, w >= h          world left, narrower panel right
    portrait   smaller, h > w           world on top, panel underneath

  Toolbar
    On touch devices (no keyboard) and on any compact screen the panel opens with a block of
    buttons. Each button presses the same key its keyboard shortcut does, so behaviour is shared.
]]

local shell = {}

shell.WIDE_W, shell.WIDE_H = 1000, 600

local touchMode = false
local buttons = {}      -- hit rects from this frame's toolbar
local flash = nil       -- brief highlight on the button just pressed

local function setColor(c, a)
  love.graphics.setColor(c[1], c[2], c[3], a or c[4] or 1)
end

function shell.setTouch(on)
  touchMode = on and true or false
end

function shell.isTouch()
  return touchMode
end

function shell.isCompact(w, h)
  if not w then w, h = love.graphics.getDimensions() end
  return w < shell.WIDE_W or h < shell.WIDE_H
end

function shell.showToolbar(w, h)
  return touchMode or shell.isCompact(w, h)
end

function shell.regions()
  local w, h = love.graphics.getDimensions()
  local mode, world, panel
  if not shell.isCompact(w, h) then
    mode = "wide"
    local panelW = 360
    world = { x = 0, y = 0, w = w - panelW, h = h }
    panel = { x = w - panelW, y = 0, w = panelW, h = h }
  elseif w >= h then
    mode = "landscape"
    local panelW = math.floor(math.max(250, math.min(340, w * 0.40)))
    world = { x = 0, y = 0, w = w - panelW, h = h }
    panel = { x = w - panelW, y = 0, w = panelW, h = h }
  else
    mode = "portrait"
    local worldH = math.floor(math.max(220, h * 0.55))
    world = { x = 0, y = 0, w = w, h = worldH }
    panel = { x = 0, y = worldH, w = w, h = h - worldH }
  end
  return { mode = mode, w = w, h = h, world = world, panel = panel, panelW = panel.w }
end

--- Call once per frame before the labs draw, so stale buttons from a hidden toolbar can't be hit.
function shell.beginFrame()
  buttons = {}
end

--- Draw `list` as wrapping rows of buttons inside `rect`; returns the height used.
--- Entry: { label = "SAT", key = "s" | action = fn, on = bool, enabled = bool, row = true (new row) }
--- Labels must be ASCII: the default LÖVE font has no arrow or symbol glyphs.
function shell.toolbar(rect, list, COLORS)
  local font = love.graphics.getFont()
  local pad, gap = 8, 6
  local bh = touchMode and 36 or 28
  local minW = touchMode and 44 or 36
  local left, right = rect.x + pad, rect.x + rect.w - pad
  local x, y = left, rect.y + pad
  local now = love.timer.getTime()

  for _, b in ipairs(list) do
    local bw = math.max(minW, font:getWidth(b.label) + 18)
    if (b.row and x > left) or (x + bw > right and x > left) then
      x = left
      y = y + bh + gap
    end
    local enabled = b.enabled ~= false
    buttons[#buttons + 1] = {
      x = x, y = y, w = bw, h = bh, key = b.key, action = b.action, enabled = enabled, label = b.label,
    }

    local lit = flash and flash.label == b.label and now < flash.untilT
    if b.on then
      setColor(COLORS.accent, enabled and 0.9 or 0.35)
    elseif lit then
      setColor(COLORS.accent, 0.45)
    else
      setColor(COLORS.muted, enabled and 0.18 or 0.07)
    end
    love.graphics.rectangle("fill", x, y, bw, bh, 4, 4)
    setColor(b.on and COLORS.accent or COLORS.muted, enabled and 0.7 or 0.25)
    love.graphics.setLineWidth(1)
    love.graphics.rectangle("line", x, y, bw, bh, 4, 4)
    love.graphics.setLineWidth(1.5)
    if b.on then
      setColor(COLORS.bg)
    else
      setColor(COLORS.text, enabled and 1 or 0.35)
    end
    love.graphics.print(b.label,
      math.floor(x + (bw - font:getWidth(b.label)) / 2),
      math.floor(y + (bh - font:getHeight()) / 2))
    x = x + bw + gap
  end
  return (y + bh + pad) - rect.y
end

--- The enabled toolbar button under (x, y), if any.
function shell.buttonAt(x, y)
  for _, r in ipairs(buttons) do
    if r.enabled and x >= r.x and x <= r.x + r.w and y >= r.y and y <= r.y + r.h then
      flash = { label = r.label, untilT = love.timer.getTime() + 0.15 }
      return r
    end
  end
  return nil
end

--- Thin scroll indicator along the right edge of a scrolled view.
function shell.scrollbar(view, scroll, maxScroll, COLORS)
  if maxScroll <= 0 then return end
  local total = view.h + maxScroll
  local barH = math.max(24, view.h * view.h / total)
  local barY = view.y + (scroll / maxScroll) * (view.h - barH)
  setColor(COLORS.muted, 0.25)
  love.graphics.rectangle("fill", view.x + view.w - 5, view.y, 3, view.h, 1, 1)
  setColor(COLORS.accent, 0.7)
  love.graphics.rectangle("fill", view.x + view.w - 5, barY, 3, barH, 1, 1)
end

return shell
