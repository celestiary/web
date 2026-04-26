import {create} from 'zustand'
import createAsterismsSlice from './AsterismsSlice'
import createDragModeSlice from './DragModeSlice'
import createSearchSlice from './SearchSlice'
import createStarsSlice from './StarsSlice'
import createTimeSlice from './TimeSlice'


const useStore = create((set, get) => ({
  ...createAsterismsSlice(set, get),
  ...createDragModeSlice(set, get),
  ...createSearchSlice(set, get),
  ...createStarsSlice(set, get),
  ...createTimeSlice(set, get),
}))

export default useStore
