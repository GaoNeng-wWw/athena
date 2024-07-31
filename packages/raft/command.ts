export enum CommandType {
  NOOP=0,
  MEMBERSHIP_ADD=1,
  MEMBERSHIP_REMOVE=2,
  STORE_SET=3,
  STORE_DEL=4,
  STORE_HSET=5,
  STORE_HDEL=6,
  STORE_SSET=7,
  STORE_SEDEL=8,
}
export class Command<T=string> {
  public type: CommandType;
  public data: T
  constructor(
    type: CommandType,
    data: T
  ){
    this.type = type;
    this.data = data;
  }
}

export const noopCommand = (id: string) => {
  return new Command<string>(
    CommandType.NOOP,
    id
  )
}

export const membershipAddCommand = (id: string) => {
  return new Command(
    CommandType.MEMBERSHIP_ADD,
    id
  )
}

export const membershipRemoveCommand = (id: string) => {
  return new Command(
    CommandType.MEMBERSHIP_REMOVE,
    id
  )
}