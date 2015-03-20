export class UnimplementedMethodError extends Error {

    get name() {
        return 'UnimplementedMethod';
    }

    constructor(message: string = 'Method not implemented!') {
        super(message);
    }
}
