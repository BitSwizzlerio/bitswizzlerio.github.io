--[[
  Uniform grid / spatial hash broadphase.

  World is partitioned into square cells of size `cellSize`.
  Each body is inserted into every cell its AABB overlaps.
  Candidate pairs = unique unordered pairs that share at least one cell.

  Hash key packing: for typical 2D playfields, cell coords fit in 16 bits.
  Falls back to string keys if coords escape the safe range.
]]

local SpatialHash = {}
SpatialHash.__index = SpatialHash

local function packKey(cx, cy)
  -- Safe for cx, cy in roughly [-32768, 32767]
  if cx >= -32768 and cx <= 32767 and cy >= -32768 and cy <= 32767 then
    return (cx + 32768) + (cy + 32768) * 65536
  end
  return tostring(cx) .. ":" .. tostring(cy)
end

function SpatialHash.new(cellSize)
  return setmetatable({
    cellSize = cellSize or 64,
    cells = {},       -- key -> { id, id, ... }
    invCell = 1 / (cellSize or 64),
    insertCount = 0,  -- total body-in-cell registrations this frame
    occupied = 0,     -- non-empty cells
  }, SpatialHash)
end

function SpatialHash:setCellSize(size)
  size = math.max(8, size)
  self.cellSize = size
  self.invCell = 1 / size
end

function SpatialHash:clear()
  self.cells = {}
  self.insertCount = 0
  self.occupied = 0
end

local function cellRange(aabb, inv, cellSize)
  local minCX = math.floor(aabb.minX * inv)
  local minCY = math.floor(aabb.minY * inv)
  local maxCX = math.floor(aabb.maxX * inv)
  local maxCY = math.floor(aabb.maxY * inv)
  -- Degenerate / inverted AABBs
  if maxCX < minCX then minCX, maxCX = maxCX, minCX end
  if maxCY < minCY then minCY, maxCY = maxCY, minCY end
  return minCX, minCY, maxCX, maxCY
end

--- Insert body id with its AABB into all overlapping cells.
function SpatialHash:insert(id, aabb)
  local minCX, minCY, maxCX, maxCY = cellRange(aabb, self.invCell, self.cellSize)
  for cy = minCY, maxCY do
    for cx = minCX, maxCX do
      local key = packKey(cx, cy)
      local bucket = self.cells[key]
      if not bucket then
        bucket = {}
        self.cells[key] = bucket
        self.occupied = self.occupied + 1
      end
      bucket[#bucket + 1] = id
      self.insertCount = self.insertCount + 1
    end
  end
end

--- Build unique candidate pairs from shared cells.
--- Returns list of { a = idA, b = idB } with a < b, plus stats.
function SpatialHash:queryPairs()
  local seen = {}
  local pairsList = {}
  local cellPairChecks = 0 -- raw pair enumerations before dedupe

  for _, bucket in pairs(self.cells) do
    local n = #bucket
    for i = 1, n - 1 do
      for j = i + 1, n do
        local idA, idB = bucket[i], bucket[j]
        if idA > idB then
          idA, idB = idB, idA
        end
        if idA ~= idB then
          cellPairChecks = cellPairChecks + 1
          local key = idA .. ":" .. idB
          if not seen[key] then
            seen[key] = true
            pairsList[#pairsList + 1] = { a = idA, b = idB }
          end
        end
      end
    end
  end

  return pairsList, {
    cellPairChecks = cellPairChecks,
    uniquePairs = #pairsList,
    occupiedCells = self.occupied,
    registrations = self.insertCount,
  }
end

--- Iterate non-empty cells for drawing.
--- fn(cx, cy, bucket, worldRect) where worldRect = {x,y,w,h}
function SpatialHash:forEachOccupied(fn)
  local s = self.cellSize
  for key, bucket in pairs(self.cells) do
    local cx, cy
    if type(key) == "number" then
      cx = (key % 65536) - 32768
      cy = math.floor(key / 65536) - 32768
    else
      local a, b = key:match("^(%-?%d+):(%-?%d+)$")
      cx, cy = tonumber(a), tonumber(b)
    end
    if cx and cy then
      fn(cx, cy, bucket, {
        x = cx * s,
        y = cy * s,
        w = s,
        h = s,
      })
    end
  end
end

--- World rect of one cell containing a point.
function SpatialHash:cellAtPoint(px, py)
  local s = self.cellSize
  local cx = math.floor(px * self.invCell)
  local cy = math.floor(py * self.invCell)
  return cx, cy, { x = cx * s, y = cy * s, w = s, h = s }
end

return SpatialHash
