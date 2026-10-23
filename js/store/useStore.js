import {create} from 'zustand'
import createARSlice from './ARSlice'
import createAsterismsSlice from './AsterismsSlice'
import createChromeSlice from './ChromeSlice'
import createColonizationSlice from './ColonizationSlice'
import createDragModeSlice from './DragModeSlice'
import createHomeSlice from './HomeSlice'
import createLayersSlice from './LayersSlice'
import createSearchSlice from './SearchSlice'
import createStarsSlice from './StarsSlice'
import createTimeSlice from './TimeSlice'
import createWidgetsSlice from './WidgetsSlice'


const useStore = create((set, get) => ({
  ...createARSlice(set, get),
  ...createAsterismsSlice(set, get),
  ...createChromeSlice(set, get),
  ...createColonizationSlice(set, get),
  ...createDragModeSlice(set, get),
  ...createHomeSlice(set, get),
  ...createLayersSlice(set, get),
  ...createSearchSlice(set, get),
  ...createStarsSlice(set, get),
  ...createTimeSlice(set, get),
  ...createWidgetsSlice(set, get),
}))

export default useStore
