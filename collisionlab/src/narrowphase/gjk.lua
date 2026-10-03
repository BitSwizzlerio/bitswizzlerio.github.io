--[[
  2D Gilbert-Johnson-Keerthi (GJK) with full step recording for visualization.

  Tests whether the Minkowski difference C = A - B contains the origin.
  Each iteration appends a step table describing direction, support, simplex,
  and the Voronoi region used to update the search direction.

  Note strings are ASCII-only so Love's default font can render them.
]]

local support = require("narrowphase.support")

local gjk = {}

local MAX_ITERS = 32
local EPS = 1e-8

local function vcopy(p)
  return {
    x = p.x, y = p.y,
    ax = p.ax, ay = p.ay,
    bx = p.bx, by = p.by,
  }
end

local function cloneSimplex(s)
  local out = {}
  for i, p in ipairs(s) do
    out[i] = vcopy(p)
  end
  return out
end

--- Replace simplex contents with the given points.
--- Always clears indices up to 3 (2D GJK max) so #t stays well-defined in Lua.
local function setSimplex(simplex, ...)
  local n = select("#", ...)
  for i = 1, 3 do
    if i <= n then
      simplex[i] = select(i, ...)
    else
      simplex[i] = nil
    end
  end
end

-- 2D form of the triple product AB x AO x AB:
--   dir = AO * (AB.AB) - AB * (AB.AO)
-- points perpendicular to AB toward AO.
local function triplePerp(abx, aby, aox, aoy)
  local ab2 = abx * abx + aby * aby
  local abao = abx * aox + aby * aoy
  return aox * ab2 - abx * abao, aoy * ab2 - aby * abao
end

--- Process simplex; returns contains_origin, ndx, ndy, region_label.
--- Simplex is stored with newest point last.
local function processSimplex(simplex)
  local n = #simplex

  if n == 1 then
    local a = simplex[1]
    return false, -a.x, -a.y, "point -> search toward origin"

  elseif n == 2 then
    local b, a = simplex[1], simplex[2]
    local abx, aby = b.x - a.x, b.y - a.y
    local aox, aoy = -a.x, -a.y
    local ab_ao = abx * aox + aby * aoy

    if ab_ao > 0 then
      local dx, dy = triplePerp(abx, aby, aox, aoy)
      if support.len(dx, dy) < EPS then
        return true, 0, 0, "origin on segment"
      end
      return false, dx, dy, "segment -> origin beside edge AB"
    else
      setSimplex(simplex, a)
      return false, aox, aoy, "segment -> origin behind A; keep A"
    end

  else
    -- Triangle: points C, B, A (A newest)
    local c, b, a = simplex[1], simplex[2], simplex[3]
    local abx, aby = b.x - a.x, b.y - a.y
    local acx, acy = c.x - a.x, c.y - a.y
    local aox, aoy = -a.x, -a.y

    -- Outside AB? (AB x AO) has opposite sign from (AB x AC)
    local ab_ao_cross = support.cross(abx, aby, aox, aoy)
    local ab_ac_cross = support.cross(abx, aby, acx, acy)

    if ab_ao_cross * ab_ac_cross < 0 then
      local ab_ao = abx * aox + aby * aoy
      if ab_ao > 0 then
        setSimplex(simplex, b, a)
        local dx, dy = triplePerp(abx, aby, aox, aoy)
        if support.len(dx, dy) < EPS then
          return true, 0, 0, "origin on edge AB"
        end
        return false, dx, dy, "triangle -> outside AB; keep edge AB"
      else
        local ac_ao = acx * aox + acy * aoy
        local ac_ao_cross = support.cross(acx, acy, aox, aoy)
        local ac_ab_cross = support.cross(acx, acy, abx, aby)
        if ac_ao > 0 and ac_ao_cross * ac_ab_cross < 0 then
          setSimplex(simplex, c, a)
          local dx, dy = triplePerp(acx, acy, aox, aoy)
          if support.len(dx, dy) < EPS then
            return true, 0, 0, "origin on edge AC"
          end
          return false, dx, dy, "triangle -> outside AC; keep edge AC"
        else
          setSimplex(simplex, a)
          return false, aox, aoy, "triangle -> vertex A region"
        end
      end
    end

    -- Outside AC?
    local ac_ao_cross = support.cross(acx, acy, aox, aoy)
    local ac_ab_cross = support.cross(acx, acy, abx, aby)
    if ac_ao_cross * ac_ab_cross < 0 then
      local ac_ao = acx * aox + acy * aoy
      if ac_ao > 0 then
        setSimplex(simplex, c, a)
        local dx, dy = triplePerp(acx, acy, aox, aoy)
        if support.len(dx, dy) < EPS then
          return true, 0, 0, "origin on edge AC"
        end
        return false, dx, dy, "triangle -> outside AC; keep edge AC"
      else
        setSimplex(simplex, a)
        return false, aox, aoy, "triangle -> vertex A region"
      end
    end

    return true, 0, 0, "origin inside triangle"
  end
end

--- Run GJK and return { colliding, steps = {...}, iterations }
function gjk.test(shapeA, shapeB)
  local steps = {}
  local simplex = {}

  -- Initial search direction in C-space: cA - cB
  local dx = shapeA.x - shapeB.x
  local dy = shapeA.y - shapeB.y
  if support.len(dx, dy) < EPS then
    dx, dy = 1, 0
  end

  local p0 = support.diffPoint(shapeA, shapeB, dx, dy)
  simplex[1] = p0

  steps[#steps + 1] = {
    phase = "init",
    dir = { x = dx, y = dy },
    support = vcopy(p0),
    simplex = cloneSimplex(simplex),
    region = "first support in dir (cA - cB)",
    passedOrigin = true,
    colliding = nil,
    note = "Seed simplex with one support point",
  }

  dx, dy = -p0.x, -p0.y
  if support.len(dx, dy) < EPS then
    steps[#steps + 1] = {
      phase = "done",
      dir = { x = 0, y = 0 },
      support = vcopy(p0),
      simplex = cloneSimplex(simplex),
      region = "first support is the origin",
      passedOrigin = true,
      colliding = true,
      note = "Origin is a support point -> C contains O",
    }
    return { colliding = true, steps = steps, iterations = 1 }
  end

  for iter = 1, MAX_ITERS do
    local p = support.diffPoint(shapeA, shapeB, dx, dy)
    local ddot = p.x * dx + p.y * dy

    if ddot < 0 then
      steps[#steps + 1] = {
        phase = "support",
        iter = iter,
        dir = { x = dx, y = dy },
        support = vcopy(p),
        simplex = cloneSimplex(simplex),
        region = "support failed to pass origin",
        passedOrigin = false,
        colliding = false,
        note = string.format(
          "dot(s,d) = %.4f < 0 -> separating plane; no intersection",
          ddot
        ),
      }
      return { colliding = false, steps = steps, iterations = iter }
    end

    simplex[#simplex + 1] = p

    local before = cloneSimplex(simplex)
    local contains, ndx, ndy, region = processSimplex(simplex)

    steps[#steps + 1] = {
      phase = contains and "done" or "iterate",
      iter = iter,
      dir = { x = dx, y = dy },
      support = vcopy(p),
      simplexBefore = before,
      simplex = cloneSimplex(simplex),
      region = region,
      passedOrigin = true,
      colliding = contains and true or nil,
      note = contains
        and "Simplex contains the origin -> COLLIDING"
        or string.format("New search dir (%.3f, %.3f); simplex size %d", ndx, ndy, #simplex),
    }

    if contains then
      return { colliding = true, steps = steps, iterations = iter }
    end

    dx, dy = ndx, ndy
    if support.len(dx, dy) < EPS then
      steps[#steps].colliding = true
      steps[#steps].note = "Search direction vanished -> origin on simplex"
      return { colliding = true, steps = steps, iterations = iter }
    end
  end

  steps[#steps + 1] = {
    phase = "done",
    dir = { x = dx, y = dy },
    support = nil,
    simplex = cloneSimplex(simplex),
    region = "max iterations",
    passedOrigin = true,
    colliding = false,
    note = "Hit iteration limit (treated as non-colliding)",
  }
  return { colliding = false, steps = steps, iterations = MAX_ITERS }
end

return gjk
