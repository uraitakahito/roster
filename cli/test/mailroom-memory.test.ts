// 試験用の配りの口（src/mailroom/memory.ts）に、配りの口の試験（mailroom-contract.ts）を流す。時は、試験が進める時計で動かす。
import { mailroomContract, SHORT_LIMITS } from './mailroom-contract.ts';
import { MemoryMailroom, MemoryPostOffice } from '../src/mailroom/memory.ts';

mailroomContract('試験用の口', () => {
  let now = Date.now();
  const office = new MemoryPostOffice(() => new Date(now), SHORT_LIMITS);
  return {
    open: () => new MemoryMailroom(office),
    pass: (ms) => {
      now += ms;
      return Promise.resolve();
    },
  };
});
