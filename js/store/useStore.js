import {create} from 'zustand'
import createStarsSlice from './StarsSlice'
import createAsterismsSlice from './AsterismsSlice'


const useStore = create((set, get) => ({
  ...createStarsSlice(set, get),
  ...createAsterismsSlice(set, get),
}))

export default useStore
